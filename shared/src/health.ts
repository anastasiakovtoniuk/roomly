// GET /api/health — docs/contracts/api_spec.md §4.

export interface HealthResponse {
  status: 'ok';
  database: 'ok' | 'unavailable';
  serverTime: string;
}
