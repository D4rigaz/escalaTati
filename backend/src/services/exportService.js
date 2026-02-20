import { getDb } from '../db/database.js';
import { getDaysInMonth, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

function getMonthData(month, year) {
  const db = getDb();
  const daysInMonth = getDaysInMonth(new Date(year, month - 1, 1));
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const employees = db.prepare('SELECT * FROM employees WHERE active = 1 ORDER BY name').all();
  const shiftTypes = db.prepare('SELECT * FROM shift_types').all();
  const shiftMap = {};
  for (const s of shiftTypes) shiftMap[s.id] = s;

  const entries = db
    .prepare(
      `SELECT se.*, st.name as shift_name, st.color as shift_color, st.duration_hours
       FROM schedule_entries se
       LEFT JOIN shift_types st ON se.shift_type_id = st.id
       WHERE se.date >= ? AND se.date <= ?
       ORDER BY se.date, se.employee_id`
    )
    .all(startDate, endDate);

  // Build entry map: { employeeId: { date: entry } }
  const entryMap = {};
  for (const entry of entries) {
    if (!entryMap[entry.employee_id]) entryMap[entry.employee_id] = {};
    entryMap[entry.employee_id][entry.date] = entry;
  }

  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(format(new Date(year, month - 1, d), 'yyyy-MM-dd'));
  }

  return { employees, shiftMap, entryMap, dates, daysInMonth };
}

export async function exportExcel(month, year) {
  const { employees, shiftMap, entryMap, dates, daysInMonth } = getMonthData(month, year);
  const monthName = format(new Date(year, month - 1, 1), 'MMMM yyyy', { locale: ptBR });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Escala Trabalho';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(`Escala ${monthName}`, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });

  // Header row: Employee name + days
  const headerRow = ['Funcionário', 'Total (h)', ...dates.map((d) => d.slice(8))]; // day numbers
  sheet.addRow(headerRow);

  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' },
    };
  });
  sheet.getRow(1).height = 22;

  // Freeze header
  sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];

  // Column widths
  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 10;
  for (let i = 3; i <= 2 + daysInMonth; i++) {
    sheet.getColumn(i).width = 6;
  }

  for (const employee of employees) {
    const empEntries = entryMap[employee.id] || {};
    let totalHours = 0;

    const rowData = [employee.name, 0];
    const cellColors = [null, null];

    for (const date of dates) {
      const entry = empEntries[date];
      if (!entry || entry.is_day_off) {
        rowData.push('F');
        cellColors.push('#E5E7EB');
      } else {
        const shift = shiftMap[entry.shift_type_id];
        if (shift) {
          rowData.push(shift.name.charAt(0)); // M, T, N
          cellColors.push(shift.color);
          totalHours += shift.duration_hours;
        } else {
          rowData.push('');
          cellColors.push(null);
        }
      }
    }
    rowData[1] = totalHours;

    const row = sheet.addRow(rowData);
    row.height = 18;

    row.eachCell((cell, colNumber) => {
      const color = cellColors[colNumber - 1];
      if (color) {
        const argb = 'FF' + color.replace('#', '');
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
      }
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      };
      if (colNumber === 1) {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
        cell.font = { size: 10 };
      }
      if (colNumber === 2) {
        const isOk = Math.abs(totalHours - 160) <= 12;
        cell.font = { bold: true, color: { argb: isOk ? 'FF166534' : 'FF991B1B' } };
      }
    });
  }

  // Legend
  sheet.addRow([]);
  const legendRow = sheet.addRow(['Legenda: M=Manhã (6h)  T=Tarde (6h)  N=Noturno (12h)  F=Folga']);
  legendRow.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

export async function exportPdf(month, year) {
  const { employees, shiftMap, entryMap, dates } = getMonthData(month, year);
  const monthName = format(new Date(year, month - 1, 1), 'MMMM yyyy', { locale: ptBR });

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`Escala de Trabalho — ${monthName.charAt(0).toUpperCase() + monthName.slice(1)}`, 14, 14);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 20);

  const head = [['Funcionário', 'Total (h)', ...dates.map((d) => d.slice(8))]];
  const body = [];
  const cellStyles = [];

  for (const employee of employees) {
    const empEntries = entryMap[employee.id] || {};
    let totalHours = 0;
    const row = [employee.name, 0];
    const styles = [{}, {}];

    for (const date of dates) {
      const entry = empEntries[date];
      if (!entry || entry.is_day_off) {
        row.push('F');
        styles.push({ fillColor: [229, 231, 235], textColor: [107, 114, 128] });
      } else {
        const shift = shiftMap[entry.shift_type_id];
        if (shift) {
          row.push(shift.name.charAt(0));
          const rgb = hexToRgb(shift.color);
          styles.push({ fillColor: rgb, textColor: [30, 30, 30] });
          totalHours += shift.duration_hours;
        } else {
          row.push('');
          styles.push({});
        }
      }
    }
    row[1] = totalHours;
    const isOk = Math.abs(totalHours - 160) <= 12;
    styles[1] = { textColor: isOk ? [22, 101, 52] : [153, 27, 27], fontStyle: 'bold' };

    body.push(row);
    cellStyles.push(styles);
  }

  autoTable(doc, {
    head,
    body,
    startY: 24,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.5, halign: 'center', valign: 'middle' },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold', fontSize: 7 },
    columnStyles: {
      0: { halign: 'left', cellWidth: 35 },
      1: { cellWidth: 12 },
    },
    didParseCell(data) {
      if (data.section === 'body') {
        const styles = cellStyles[data.row.index]?.[data.column.index];
        if (styles) Object.assign(data.cell.styles, styles);
      }
    },
    margin: { top: 24, left: 5, right: 5 },
  });

  // Legend
  const finalY = doc.lastAutoTable.finalY + 5;
  doc.setFontSize(7);
  doc.setTextColor(107, 114, 128);
  doc.text('Legenda: M = Manhã (6h)   T = Tarde (6h)   N = Noturno (12h)   F = Folga', 5, finalY);

  return Buffer.from(doc.output('arraybuffer'));
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [255, 255, 255];
}
