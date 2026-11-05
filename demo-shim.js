/* демо: заявки и бронь никуда не уходят, подтверждение показывается как на сайте */
(function () {
  var real = window.fetch.bind(window);
  function json(data) {
    return Promise.resolve(new Response(JSON.stringify(data), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
  }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method === 'POST' && /\/bookings$/.test(url)) {
      return json({ bookingId: 'D' + Math.floor(Math.random() * 9000 + 1000), paymentUrl: null });
    }
    if (method === 'POST' && /contact-forms\/\d+\/feedback$/.test(url)) {
      return json({ status: 'mail_sent', message: 'Заявка принята, мы свяжемся с вами.', invalid_fields: [] });
    }
    return real(input, init);
  };
})();
