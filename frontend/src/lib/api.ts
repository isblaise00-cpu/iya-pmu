import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

const TOKEN_KEY = 'pmu_token';

export const getStoredToken = () => localStorage.getItem(TOKEN_KEY);
export const setStoredToken = (token: string) => {
  localStorage.setItem(TOKEN_KEY, token);
  api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
};
export const clearStoredToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  delete api.defaults.headers.common['Authorization'];
};

const _t = getStoredToken();
if (_t) api.defaults.headers.common['Authorization'] = `Bearer ${_t}`;

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isAuthCheck = err.config?.url?.includes('/auth/me');
    if (err.response?.status === 401 && !isAuthCheck && !window.location.pathname.includes('/login')) {
      clearStoredToken();
      window.location.href = '/login';
    }
    const message = err.response?.data?.error || err.message || 'Une erreur est survenue';
    return Promise.reject(new Error(message));
  }
);

// Pronostics
export const getPronostics = () => api.get('/pronostics').then((r) => r.data);
export const getTodayRace = () => api.get('/pronostics/today').then((r) => r.data);
export const updatePronostic = (id: number, data: any) => api.put(`/pronostics/${id}`, data).then((r) => r.data);
export const startScrapingPipeline = (force = false) =>
  api.post(`/pronostics/scrape/start${force ? '?force=true' : ''}`).then((r) => r.data as { jobId: string });
export const getScrapingJob = (jobId: string) => api.get(`/pronostics/scrape/job/${jobId}`).then((r) => r.data);
export const sendPronostic = (id: number) => api.post(`/pronostics/${id}/send`).then((r) => r.data);

// Results
export const getResults = () => api.get('/results').then((r) => r.data);
export const fetchResults = () => api.post('/results/fetch').then((r) => r.data);
export const sendResult = (id: number) => api.post(`/results/${id}/send`).then((r) => r.data);

// Subscribers
export const getSubscribers = (params?: any) => api.get('/subscribers', { params }).then((r) => r.data);
export const createSubscriber = (data: any) => api.post('/subscribers', data).then((r) => r.data);
export const updateSubscriber = (id: number, data: any) => api.put(`/subscribers/${id}`, data).then((r) => r.data);
export const deleteSubscriber = (id: number) => api.delete(`/subscribers/${id}`).then((r) => r.data);
export const getSubscriberPayments = (id: number) => api.get(`/subscribers/${id}/payments`).then((r) => r.data);

// Plans
export const getPlans = () => api.get('/plans').then((r) => r.data);
export const createPlan = (data: any) => api.post('/plans', data).then((r) => r.data);
export const updatePlan = (id: number, data: any) => api.put(`/plans/${id}`, data).then((r) => r.data);
export const deletePlan = (id: number) => api.delete(`/plans/${id}`).then((r) => r.data);

// SMS — Campagnes
export const getSmsCampaigns = () => api.get('/sms/campaigns').then((r) => r.data);
export const createSmsCampaign = (data: any) => api.post('/sms/campaigns', data).then((r) => r.data);
export const sendSmsCampaign = (id: number) => api.post(`/sms/campaigns/${id}/send`).then((r) => r.data);
export const getSmsLogs = (params?: any) => api.get('/sms/logs', { params }).then((r) => r.data);
export const resendSmsLog = (id: number) => api.post(`/sms/logs/${id}/resend`).then((r) => r.data);
export const sendPronosticToSubscriber = (pronosticId: number, subscriberId: number) =>
  api.post(`/pronostics/${pronosticId}/send-to/${subscriberId}`).then((r) => r.data);

// SMS — Modèles
export const getSmsTemplates = () => api.get('/sms/templates').then((r) => r.data);
export const createSmsTemplate = (data: any) => api.post('/sms/templates', data).then((r) => r.data);
export const updateSmsTemplate = (id: number, data: any) => api.put(`/sms/templates/${id}`, data).then((r) => r.data);
export const deleteSmsTemplate = (id: number) => api.delete(`/sms/templates/${id}`).then((r) => r.data);

// Dashboard
export const getDashboardStats = () => api.get('/dashboard/stats').then((r) => r.data);
export const getDashboardCharts = () => api.get('/dashboard/charts').then((r) => r.data);

// Settings
export const getSettings = () => api.get('/settings').then((r) => r.data);
export const updateSettings = (data: any) => api.put('/settings', data).then((r) => r.data);

// Sports pronostics
export const getSportPronostics = (sport: string) => api.get(`/sports/${sport}`).then((r) => r.data);
export const getSportPronosticsToday = (sport: string) => api.get(`/sports/${sport}/today`).then((r) => r.data);
export const updateSportPronostic = (sport: string, id: number, data: any) =>
  api.put(`/sports/${sport}/${id}`, data).then((r) => r.data);
export const startSportPipeline = (sport: string, force = false) =>
  api.post(`/sports/${sport}/scrape/start${force ? '?force=true' : ''}`).then((r) => r.data as { jobId: string });
export const getSportScrapingJob = (sport: string, jobId: string) =>
  api.get(`/sports/${sport}/scrape/job/${jobId}`).then((r) => r.data);
export const sendSportPronostic = (sport: string, id: number) =>
  api.post(`/sports/${sport}/${id}/send`).then((r) => r.data);
export const getSportLeagues = (sport: string, date?: string) =>
  api.get(`/sports/${sport}/leagues`, { params: date ? { date } : undefined }).then((r) => r.data as { date: string; total: number; leagues: { league_id: string; league_name: string; country: string; match_count: number }[] });
export const getSportMatches = (sport: string, leagueId: string, date?: string) =>
  api.get(`/sports/${sport}/matches`, { params: { league_id: leagueId, ...(date ? { date } : {}) } }).then((r) => r.data as { date: string; league_id: string; league_name: string; matches: { external_id: string; home_team: string; away_team: string; kickoff: string; status: string; round: string; prediction?: { bsd_prob_home: number; bsd_prob_draw: number; bsd_prob_away: number; bsd_predicted: string; bsd_xg_home: number; bsd_xg_away: number; bsd_prob_over_15: number; bsd_prob_over_25: number; bsd_prob_over_35: number; bsd_prob_btts: number; bsd_confidence: number; bsd_favorite: string; bsd_favorite_prob: number } }[] });
