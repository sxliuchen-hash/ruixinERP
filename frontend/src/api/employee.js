/**
 * 员工档案接口
 */
import request from './request'

export function getEmployeeList(params) {
  return request.get('/employees', { params })
}

export function getEmployee(id) {
  return request.get(`/employees/${id}`)
}

export function createEmployee(data) {
  return request.post('/employees', data)
}

export function updateEmployee(id, data) {
  return request.put(`/employees/${id}`, data)
}

export function deleteEmployee(id) {
  return request.delete(`/employees/${id}`)
}

export function changeGrade(id, grade) {
  return request.put(`/employees/${id}/grade`, { grade })
}

export function changeStatus(id, data) {
  return request.put(`/employees/${id}/status`, data)
}
