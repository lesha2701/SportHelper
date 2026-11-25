import { apiRequest, apiUpload } from './client';
export interface ApplicationDetails { sport: string; qualification: string; experience: string; about: string; links: string[] }
export interface Application extends ApplicationDetails {
  id: string; user_id: string; status: 'pending' | 'needs_info' | 'approved' | 'rejected';
  admin_note: string | null; resubmit_after: string | null; created_at: string; updated_at: string;
  email: string | null; first_name: string | null; last_name: string | null;
  documents: { id: string; filename: string; mime_type: string; created_at: string }[];
}
export function myApplication() { return apiRequest<Application | null>('/api/coach-applications/mine'); }
export function resubmitApplication(details: ApplicationDetails, files: File[]) {
  const formData = new FormData(); formData.append('details', JSON.stringify(details));
  files.forEach((file) => formData.append('documents', file));
  return apiUpload<Application>('/api/coach-applications/mine/resubmit', { formData, silent: true });
}
export function listApplications() { return apiRequest<Application[]>('/api/admin/coach-applications'); }
export function decideApplication(id: string, action: 'approve' | 'needs_info' | 'reject', note: string) {
  return apiRequest<Application>(`/api/admin/coach-applications/${id}/decision`, { method: 'POST', body: { action, note }, silent: true });
}
