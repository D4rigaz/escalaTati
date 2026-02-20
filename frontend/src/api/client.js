import axios from 'axios';

const client = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Employees
export const employeesApi = {
  list: (params) => client.get('/employees', { params }).then((r) => r.data),
  get: (id) => client.get(`/employees/${id}`).then((r) => r.data),
  create: (data) => client.post('/employees', data).then((r) => r.data),
  update: (id, data) => client.put(`/employees/${id}`, data).then((r) => r.data),
  delete: (id) => client.delete(`/employees/${id}`).then((r) => r.data),
};

// Shift types
export const shiftTypesApi = {
  list: () => client.get('/shift-types').then((r) => r.data),
  create: (data) => client.post('/shift-types', data).then((r) => r.data),
  update: (id, data) => client.put(`/shift-types/${id}`, data).then((r) => r.data),
  delete: (id) => client.delete(`/shift-types/${id}`).then((r) => r.data),
};

// Schedules
export const schedulesApi = {
  get: (month, year) => client.get('/schedules', { params: { month, year } }).then((r) => r.data),
  generate: (data) => client.post('/schedules/generate', data).then((r) => r.data),
  updateEntry: (id, data) => client.put(`/schedules/entry/${id}`, data).then((r) => r.data),
  clearMonth: (month, year) =>
    client.delete('/schedules/month', { params: { month, year } }).then((r) => r.data),
};

// Export (returns blob)
export const exportApi = {
  excel: (month, year) =>
    client
      .get('/export/excel', { params: { month, year }, responseType: 'blob' })
      .then((r) => r.data),
  pdf: (month, year) =>
    client
      .get('/export/pdf', { params: { month, year }, responseType: 'blob' })
      .then((r) => r.data),
};

export default client;
