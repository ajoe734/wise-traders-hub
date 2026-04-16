import { http, HttpResponse } from 'msw';

export const handlers = [
  http.post('/functions/v1/acpay-notify', () =>
    HttpResponse.json({ success: true }, { status: 200 })
  ),
  http.post('/functions/v1/acpay-recurring-notify', () =>
    HttpResponse.json({ success: true }, { status: 200 })
  ),
  http.post('/functions/v1/ecpay-callback', () =>
    HttpResponse.json({ success: true }, { status: 200 })
  ),
  http.post('/functions/v1/confirm-linepay', () =>
    HttpResponse.json({ success: true }, { status: 200 })
  ),
  http.post('/functions/v1/process-refund', () =>
    HttpResponse.json({ success: true }, { status: 200 })
  ),
  http.post('/functions/v1/line-webhook', () =>
    HttpResponse.json({ success: true }, { status: 200 })
  ),
];
