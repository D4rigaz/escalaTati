import { create } from 'zustand';
import { employeesApi, shiftTypesApi, schedulesApi } from '../api/client.js';
import { format } from 'date-fns';

const useStore = create((set, get) => ({
  // ── Employees ──────────────────────────────────────────────
  employees: [],
  employeesLoading: false,
  employeesError: null,

  fetchEmployees: async () => {
    set({ employeesLoading: true, employeesError: null });
    try {
      const data = await employeesApi.list();
      set({ employees: data, employeesLoading: false });
    } catch (err) {
      set({ employeesError: err.message, employeesLoading: false });
    }
  },

  createEmployee: async (data) => {
    const employee = await employeesApi.create(data);
    set((state) => ({ employees: [...state.employees, employee] }));
    return employee;
  },

  updateEmployee: async (id, data) => {
    const employee = await employeesApi.update(id, data);
    set((state) => ({
      employees: state.employees.map((e) => (e.id === id ? employee : e)),
    }));
    return employee;
  },

  deleteEmployee: async (id) => {
    await employeesApi.delete(id);
    set((state) => ({ employees: state.employees.filter((e) => e.id !== id) }));
  },

  // ── Shift Types ────────────────────────────────────────────
  shiftTypes: [],
  shiftTypesLoading: false,

  fetchShiftTypes: async () => {
    set({ shiftTypesLoading: true });
    try {
      const data = await shiftTypesApi.list();
      set({ shiftTypes: data, shiftTypesLoading: false });
    } catch {
      set({ shiftTypesLoading: false });
    }
  },

  updateShiftType: async (id, data) => {
    const updated = await shiftTypesApi.update(id, data);
    set((state) => ({
      shiftTypes: state.shiftTypes.map((s) => (s.id === id ? updated : s)),
    }));
    return updated;
  },

  // ── Schedule ───────────────────────────────────────────────
  currentMonth: new Date().getMonth() + 1,
  currentYear: new Date().getFullYear(),
  scheduleData: null,
  scheduleLoading: false,
  scheduleGenerating: false,
  scheduleError: null,

  setCurrentPeriod: (month, year) => {
    set({ currentMonth: month, currentYear: year });
    get().fetchSchedule(month, year);
  },

  fetchSchedule: async (month, year) => {
    const m = month ?? get().currentMonth;
    const y = year ?? get().currentYear;
    set({ scheduleLoading: true, scheduleError: null });
    try {
      const data = await schedulesApi.get(m, y);
      set({ scheduleData: data, scheduleLoading: false });
    } catch (err) {
      set({ scheduleError: err.message, scheduleLoading: false });
    }
  },

  generateSchedule: async (overwriteLocked = false) => {
    const { currentMonth, currentYear } = get();
    set({ scheduleGenerating: true, scheduleError: null });
    try {
      const result = await schedulesApi.generate({
        month: currentMonth,
        year: currentYear,
        overwriteLocked,
      });
      await get().fetchSchedule();
      set({ scheduleGenerating: false });
      return result;
    } catch (err) {
      set({ scheduleError: err.message, scheduleGenerating: false });
      throw err;
    }
  },

  updateScheduleEntry: async (id, data) => {
    const updated = await schedulesApi.updateEntry(id, data);
    set((state) => {
      if (!state.scheduleData) return {};
      return {
        scheduleData: {
          ...state.scheduleData,
          entries: state.scheduleData.entries.map((e) => (e.id === id ? { ...e, ...updated } : e)),
        },
      };
    });
    return updated;
  },

  clearSchedule: async () => {
    const { currentMonth, currentYear } = get();
    await schedulesApi.clearMonth(currentMonth, currentYear);
    set({ scheduleData: null });
  },

  // ── Toast notifications ────────────────────────────────────
  toasts: [],
  addToast: (toast) => {
    const id = Date.now();
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, toast.duration ?? 4000);
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export default useStore;
