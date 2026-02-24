import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import useStore from '../store/useStore.js';
import { employeesApi, shiftTypesApi, schedulesApi, vacationsApi } from '../api/client.js';

vi.mock('../api/client.js', () => ({
  employeesApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  shiftTypesApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  schedulesApi: {
    get: vi.fn(),
    generate: vi.fn(),
    updateEntry: vi.fn(),
    clearMonth: vi.fn(),
  },
  vacationsApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const resetStore = () => {
  useStore.setState({
    employees: [],
    employeesLoading: false,
    employeesError: null,
    shiftTypes: [],
    shiftTypesLoading: false,
    scheduleData: null,
    scheduleLoading: false,
    scheduleGenerating: false,
    scheduleError: null,
    toasts: [],
  });
};

// ─── Employees ────────────────────────────────────────────────────────────────

describe('useStore — Employees', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('fetchEmployees: popula employees e limpa loading em sucesso', async () => {
    const mockEmployees = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Bruno' }];
    employeesApi.list.mockResolvedValue(mockEmployees);

    await useStore.getState().fetchEmployees();

    const state = useStore.getState();
    expect(state.employees).toEqual(mockEmployees);
    expect(state.employeesLoading).toBe(false);
    expect(state.employeesError).toBeNull();
  });

  it('fetchEmployees: seta employeesError em falha e limpa loading', async () => {
    employeesApi.list.mockRejectedValue(new Error('Network error'));

    await useStore.getState().fetchEmployees();

    const state = useStore.getState();
    expect(state.employees).toEqual([]);
    expect(state.employeesError).toBe('Network error');
    expect(state.employeesLoading).toBe(false);
  });

  it('createEmployee: adiciona funcionário ao final da lista', async () => {
    const existing = { id: 1, name: 'Ana' };
    useStore.setState({ employees: [existing] });
    const newEmp = { id: 2, name: 'Bruno' };
    employeesApi.create.mockResolvedValue(newEmp);

    const result = await useStore.getState().createEmployee({ name: 'Bruno' });

    expect(result).toEqual(newEmp);
    expect(useStore.getState().employees).toEqual([existing, newEmp]);
  });

  it('updateEmployee: substitui o funcionário correto na lista', async () => {
    useStore.setState({ employees: [{ id: 1, name: 'Ana' }, { id: 2, name: 'Bruno' }] });
    const updated = { id: 1, name: 'Ana Atualizada' };
    employeesApi.update.mockResolvedValue(updated);

    const result = await useStore.getState().updateEmployee(1, { name: 'Ana Atualizada' });

    expect(result).toEqual(updated);
    expect(useStore.getState().employees).toEqual([updated, { id: 2, name: 'Bruno' }]);
  });

  it('deleteEmployee: remove o funcionário correto da lista', async () => {
    useStore.setState({ employees: [{ id: 1, name: 'Ana' }, { id: 2, name: 'Bruno' }] });
    employeesApi.delete.mockResolvedValue({});

    await useStore.getState().deleteEmployee(1);

    expect(useStore.getState().employees).toEqual([{ id: 2, name: 'Bruno' }]);
  });

  it('deleteEmployee: lista vazia não lança erro', async () => {
    employeesApi.delete.mockResolvedValue({});
    await expect(useStore.getState().deleteEmployee(99)).resolves.toBeUndefined();
  });
});

// ─── Vacations ────────────────────────────────────────────────────────────────

describe('useStore — Vacations', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    useStore.setState({ employees: [{ id: 1, name: 'Ana', vacations: [] }] });
  });

  it('fetchVacations: associa férias ao funcionário correto', async () => {
    const vacs = [{ id: 10, start_date: '2025-01-01', end_date: '2025-01-07' }];
    vacationsApi.list.mockResolvedValue(vacs);

    await useStore.getState().fetchVacations(1);

    const emp = useStore.getState().employees.find((e) => e.id === 1);
    expect(emp.vacations).toEqual(vacs);
  });

  it('fetchVacations: não altera outros funcionários', async () => {
    useStore.setState({
      employees: [
        { id: 1, name: 'Ana', vacations: [] },
        { id: 2, name: 'Bruno', vacations: [] },
      ],
    });
    vacationsApi.list.mockResolvedValue([{ id: 10 }]);

    await useStore.getState().fetchVacations(1);

    const bruno = useStore.getState().employees.find((e) => e.id === 2);
    expect(bruno.vacations).toEqual([]);
  });

  it('createVacation: adiciona férias ao final da lista do funcionário', async () => {
    const existing = { id: 10, start_date: '2025-01-01', end_date: '2025-01-07' };
    useStore.setState({ employees: [{ id: 1, name: 'Ana', vacations: [existing] }] });
    const newVac = { id: 11, start_date: '2025-02-01', end_date: '2025-02-07' };
    vacationsApi.create.mockResolvedValue(newVac);

    await useStore.getState().createVacation(1, { start_date: '2025-02-01', end_date: '2025-02-07' });

    const emp = useStore.getState().employees.find((e) => e.id === 1);
    expect(emp.vacations).toEqual([existing, newVac]);
  });

  it('updateVacation: substitui a féria correta', async () => {
    useStore.setState({
      employees: [{ id: 1, name: 'Ana', vacations: [{ id: 10, notes: '' }, { id: 11, notes: '' }] }],
    });
    const updated = { id: 10, notes: 'Médica' };
    vacationsApi.update.mockResolvedValue(updated);

    await useStore.getState().updateVacation(1, 10, { notes: 'Médica' });

    const emp = useStore.getState().employees.find((e) => e.id === 1);
    expect(emp.vacations).toEqual([updated, { id: 11, notes: '' }]);
  });

  it('deleteVacation: remove a féria correta e preserva as demais', async () => {
    useStore.setState({
      employees: [{ id: 1, name: 'Ana', vacations: [{ id: 10 }, { id: 11 }] }],
    });
    vacationsApi.delete.mockResolvedValue({});

    await useStore.getState().deleteVacation(1, 10);

    const emp = useStore.getState().employees.find((e) => e.id === 1);
    expect(emp.vacations).toEqual([{ id: 11 }]);
  });
});

// ─── Shift Types ──────────────────────────────────────────────────────────────

describe('useStore — Shift Types', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('fetchShiftTypes: popula shiftTypes e limpa loading', async () => {
    const shifts = [{ id: 1, name: 'Noturno' }, { id: 2, name: 'Diurno' }];
    shiftTypesApi.list.mockResolvedValue(shifts);

    await useStore.getState().fetchShiftTypes();

    expect(useStore.getState().shiftTypes).toEqual(shifts);
    expect(useStore.getState().shiftTypesLoading).toBe(false);
  });

  it('fetchShiftTypes: limpa loading em falha sem explodir', async () => {
    shiftTypesApi.list.mockRejectedValue(new Error('Timeout'));

    await useStore.getState().fetchShiftTypes();

    expect(useStore.getState().shiftTypesLoading).toBe(false);
    expect(useStore.getState().shiftTypes).toEqual([]);
  });

  it('createShiftType: adiciona ao final da lista', async () => {
    useStore.setState({ shiftTypes: [{ id: 1, name: 'Noturno' }] });
    const created = { id: 2, name: 'Administrativo' };
    shiftTypesApi.create.mockResolvedValue(created);

    const result = await useStore.getState().createShiftType({ name: 'Administrativo' });

    expect(result).toEqual(created);
    expect(useStore.getState().shiftTypes).toEqual([{ id: 1, name: 'Noturno' }, created]);
  });

  it('updateShiftType: substitui o turno correto', async () => {
    useStore.setState({ shiftTypes: [{ id: 1, name: 'Noturno' }, { id: 2, name: 'Diurno' }] });
    const updated = { id: 1, name: 'Noturno 12h' };
    shiftTypesApi.update.mockResolvedValue(updated);

    await useStore.getState().updateShiftType(1, { name: 'Noturno 12h' });

    expect(useStore.getState().shiftTypes).toEqual([updated, { id: 2, name: 'Diurno' }]);
  });

  it('deleteShiftType: remove o turno correto e preserva os demais', async () => {
    useStore.setState({ shiftTypes: [{ id: 1, name: 'Noturno' }, { id: 2, name: 'Diurno' }] });
    shiftTypesApi.delete.mockResolvedValue({});

    await useStore.getState().deleteShiftType(1);

    expect(useStore.getState().shiftTypes).toEqual([{ id: 2, name: 'Diurno' }]);
  });
});

// ─── Schedule ─────────────────────────────────────────────────────────────────

describe('useStore — Schedule', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('setCurrentPeriod: atualiza mês/ano e busca a escala', async () => {
    const mockData = { entries: [], totals: [], month: 3, year: 2025 };
    schedulesApi.get.mockResolvedValue(mockData);

    await useStore.getState().setCurrentPeriod(3, 2025);

    const state = useStore.getState();
    expect(state.currentMonth).toBe(3);
    expect(state.currentYear).toBe(2025);
    expect(state.scheduleData).toEqual(mockData);
  });

  it('fetchSchedule: seta scheduleData e limpa loading em sucesso', async () => {
    const mockData = { entries: [], totals: [], month: 1, year: 2025 };
    schedulesApi.get.mockResolvedValue(mockData);

    await useStore.getState().fetchSchedule(1, 2025);

    expect(useStore.getState().scheduleData).toEqual(mockData);
    expect(useStore.getState().scheduleLoading).toBe(false);
    expect(useStore.getState().scheduleError).toBeNull();
  });

  it('fetchSchedule: seta scheduleError e limpa loading em falha', async () => {
    schedulesApi.get.mockRejectedValue(new Error('Timeout'));

    await useStore.getState().fetchSchedule(1, 2025);

    expect(useStore.getState().scheduleData).toBeNull();
    expect(useStore.getState().scheduleError).toBe('Timeout');
    expect(useStore.getState().scheduleLoading).toBe(false);
  });

  it('fetchSchedule: usa currentMonth/currentYear quando não passados', async () => {
    useStore.setState({ currentMonth: 5, currentYear: 2025 });
    schedulesApi.get.mockResolvedValue({ entries: [], totals: [] });

    await useStore.getState().fetchSchedule();

    expect(schedulesApi.get).toHaveBeenCalledWith(5, 2025);
  });

  it('generateSchedule: chama generate com params corretos e refetch', async () => {
    useStore.setState({ currentMonth: 2, currentYear: 2025 });
    const genResult = { results: [], warnings: [] };
    schedulesApi.generate.mockResolvedValue(genResult);
    schedulesApi.get.mockResolvedValue({ entries: [], totals: [] });

    const result = await useStore.getState().generateSchedule(true);

    expect(schedulesApi.generate).toHaveBeenCalledWith({
      month: 2,
      year: 2025,
      overwriteLocked: true,
    });
    expect(schedulesApi.get).toHaveBeenCalled();
    expect(result).toEqual(genResult);
    expect(useStore.getState().scheduleGenerating).toBe(false);
  });

  it('generateSchedule: re-lança erro e limpa scheduleGenerating', async () => {
    useStore.setState({ currentMonth: 1, currentYear: 2025 });
    schedulesApi.generate.mockRejectedValue(new Error('Generate failed'));

    await expect(useStore.getState().generateSchedule()).rejects.toThrow('Generate failed');

    expect(useStore.getState().scheduleGenerating).toBe(false);
    expect(useStore.getState().scheduleError).toBe('Generate failed');
  });

  it('updateScheduleEntry: atualiza a entrada correta e preserva as demais', async () => {
    useStore.setState({
      scheduleData: {
        entries: [
          { id: 1, is_day_off: 1, shift_type_id: null },
          { id: 2, is_day_off: 0, shift_type_id: 3 },
        ],
        totals: [],
      },
    });
    const updated = { id: 1, is_day_off: 0, shift_type_id: 2, notes: 'ok' };
    schedulesApi.updateEntry.mockResolvedValue(updated);

    await useStore.getState().updateScheduleEntry(1, { is_day_off: 0, shift_type_id: 2 });

    const entries = useStore.getState().scheduleData.entries;
    expect(entries[0]).toMatchObject(updated);
    expect(entries[1]).toEqual({ id: 2, is_day_off: 0, shift_type_id: 3 });
  });

  it('updateScheduleEntry: no-op quando scheduleData é null', async () => {
    const updated = { id: 1, is_day_off: 0 };
    schedulesApi.updateEntry.mockResolvedValue(updated);

    await useStore.getState().updateScheduleEntry(1, { is_day_off: 0 });

    expect(useStore.getState().scheduleData).toBeNull();
  });

  it('clearSchedule: limpa scheduleData e chama clearMonth', async () => {
    useStore.setState({
      currentMonth: 3,
      currentYear: 2025,
      scheduleData: { entries: [{ id: 1 }], totals: [] },
    });
    schedulesApi.clearMonth.mockResolvedValue({});

    await useStore.getState().clearSchedule();

    expect(schedulesApi.clearMonth).toHaveBeenCalledWith(3, 2025);
    expect(useStore.getState().scheduleData).toBeNull();
  });
});

// ─── Toast ────────────────────────────────────────────────────────────────────

describe('useStore — Toast', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('addToast: adiciona toast com id atribuído', () => {
    useStore.getState().addToast({ message: 'Sucesso!', type: 'success' });

    const { toasts } = useStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ message: 'Sucesso!', type: 'success' });
    expect(toasts[0].id).toBeDefined();
  });

  it('addToast: remove automaticamente após duração padrão (4000ms)', () => {
    useStore.getState().addToast({ message: 'Auto-remove' });

    expect(useStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it('addToast: respeita duration customizada', () => {
    useStore.getState().addToast({ message: 'Custom', duration: 1000 });

    vi.advanceTimersByTime(999);
    expect(useStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it('removeToast: remove pelo id e preserva os demais', () => {
    useStore.getState().addToast({ message: 'A' });
    vi.advanceTimersByTime(1);
    useStore.getState().addToast({ message: 'B' });

    const idA = useStore.getState().toasts[0].id;
    useStore.getState().removeToast(idA);

    const remaining = useStore.getState().toasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toBe('B');
  });

  it('addToast: múltiplos toasts coexistem sem colisão de id', () => {
    useStore.getState().addToast({ message: 'X' });
    vi.advanceTimersByTime(1);
    useStore.getState().addToast({ message: 'Y' });
    vi.advanceTimersByTime(1);
    useStore.getState().addToast({ message: 'Z' });

    const ids = useStore.getState().toasts.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(useStore.getState().toasts).toHaveLength(3);
  });
});
