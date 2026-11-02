/*
 * Booking widget for the property page: pick dates, see a live price from Guesty, pay and book.
 * Card details never touch this site: Guesty's own payment form (in an iframe) collects them and hands back a token.
 */
(function () {
  "use strict";

  var dataEl = document.getElementById("stay-data");
  var root = document.getElementById("booking-app");
  if (!dataEl || !root) return;
  var S = JSON.parse(dataEl.textContent);

  /* ---------- small helpers ---------- */

  function $(sel, ctx) { return (ctx || root).querySelector(sel); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  var fmt = new Intl.NumberFormat(S.locale, { style: "currency", currency: S.currency, maximumFractionDigits: 0 });
  var fmtExact = new Intl.NumberFormat(S.locale, { style: "currency", currency: S.currency });
  function money(n) { return Math.abs(n - Math.round(n)) < 0.005 ? fmt.format(n) : fmtExact.format(n); }
  function utc(d) { return new Date(d + "T00:00:00Z"); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function addDays(d, n) { var x = utc(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); }
  function nights(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
  function longDate(d) {
    return new Intl.DateTimeFormat(S.locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(utc(d));
  }
  function monthLabel(first) {
    return new Intl.DateTimeFormat(S.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(utc(first));
  }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

  function post(url, body) {
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!r.ok) {
            var e = new Error((data && data.error && data.error.message) || "Something went wrong. Please try again.");
            e.code = data && data.error && data.error.code;
            throw e;
          }
          return data;
        });
      }, function () { throw new Error("We could not connect. Please check your internet and try again."); });
  }
  function getJson(url) {
    return fetch(url).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (!r.ok) throw new Error((data && data.error && data.error.message) || "Could not load.");
        return data;
      });
    }, function () { throw new Error("We could not connect. Please check your internet and try again."); });
  }

  /* ---------- state ---------- */

  var st = {
    days: {},
    calendarEnd: S.today,
    month: S.today.slice(0, 8) + "01",
    checkIn: null,
    checkOut: null,
    guests: S.prefill && S.prefill.guests ? S.prefill.guests : Math.min(2, S.sleeps),
    quote: null,
    rate: 0,
    qseq: 0,
    provider: null,
    busy: false,
    payValid: false,
    sdk: null,
    payReady: false,
  };

  /* ---------- skeleton ---------- */

  root.innerHTML =
    '<div><div class="lbl">Dates</div><div id="cal"></div><p class="hint" id="cal-msg" role="status"></p></div>' +
    '<div class="field"><label for="b-guests">Guests</label><select id="b-guests"></select></div>' +
    '<div id="quote" class="quote" aria-live="polite"></div>' +
    '<form id="checkout" hidden novalidate>' +
    '<h3>Your details</h3>' +
    '<div class="formgrid">' +
    '<div class="field"><label for="b-first">First name</label><input id="b-first" type="text" autocomplete="given-name" required></div>' +
    '<div class="field"><label for="b-last">Last name</label><input id="b-last" type="text" autocomplete="family-name" required></div>' +
    '<div class="field full"><label for="b-email">Email</label><input id="b-email" type="email" autocomplete="email" required></div>' +
    '<div class="field full"><label for="b-phone">Phone (optional)</label><input id="b-phone" type="tel" autocomplete="tel"></div>' +
    '</div>' +
    '<h3>Payment</h3>' +
    '<div id="pay-container"><p class="hint">Loading secure payment form...</p></div>' +
    '<label class="check"><input type="checkbox" id="b-terms"><span id="b-terms-text"></span></label>' +
    '<label class="check"><input type="checkbox" id="b-marketing"><span>Send me occasional offers (optional)</span></label>' +
    '<p class="err" id="b-err" role="alert"></p>' +
    '<button class="btn block" id="b-pay" type="submit" disabled>Book now</button>' +
    '<p class="hint" id="b-status" role="status"></p>' +
    '</form>' +
    '<div id="done" class="done" hidden></div>';

  var calEl = $("#cal"), calMsg = $("#cal-msg"), guestsEl = $("#b-guests"), quoteEl = $("#quote");
  var form = $("#checkout"), errEl = $("#b-err"), payBtn = $("#b-pay"), statusEl = $("#b-status");

  for (var g = 1; g <= S.sleeps; g++) guestsEl.appendChild(el("option", { value: String(g), text: plural(g, "guest") }));
  guestsEl.value = String(Math.min(st.guests, S.sleeps));
  guestsEl.addEventListener("change", function () {
    st.guests = parseInt(guestsEl.value, 10);
    if (st.checkIn && st.checkOut) requestQuote();
  });

  (function termsText() {
    var span = $("#b-terms-text");
    span.appendChild(document.createTextNode("I accept the booking terms"));
    if (S.termsUrl) {
      span.appendChild(document.createTextNode(" ("));
      span.appendChild(el("a", { href: S.termsUrl, target: "_blank", rel: "noopener", text: "read them" }));
      span.appendChild(document.createTextNode(")"));
    }
    if (S.privacyUrl) {
      span.appendChild(document.createTextNode(" and "));
      span.appendChild(el("a", { href: S.privacyUrl, target: "_blank", rel: "noopener", text: "privacy policy" }));
    }
  })();

  /* ---------- calendar ---------- */

  function setCalMsg(t) { calMsg.textContent = t || ""; }

  function canStart(d) {
    var x = st.days[d];
    return d >= S.today && !!x && x.status === "available" && !x.cta;
  }
  function rangeError(a, b) {
    var n = nights(a, b);
    var start = st.days[a];
    var min = Math.max(S.minNights || 1, (start && start.minNights) || 1);
    if (n < min) return "The minimum stay for these dates is " + plural(min, "night") + ".";
    if (S.maxNights && n > S.maxNights) return "The maximum stay is " + plural(S.maxNights, "night") + ".";
    for (var i = 0; i < n; i++) {
      var x = st.days[addDays(a, i)];
      if (!x || x.status !== "available") return "Some of those nights are not available.";
    }
    var end = st.days[b];
    if (end && end.ctd) return "Departures are not possible on that day.";
    return "";
  }

  function renderCalendar() {
    clear(calEl);
    var first = st.month;
    var d0 = utc(first);
    var head = el("div", { class: "cal-head" });
    var prev = el("button", { type: "button", class: "cal-nav", "aria-label": "Previous month", text: "‹" });
    var next = el("button", { type: "button", class: "cal-nav", "aria-label": "Next month", text: "›" });
    prev.disabled = first <= S.today.slice(0, 8) + "01";
    var nextFirst = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1));
    next.disabled = iso(nextFirst) > st.calendarEnd;
    prev.addEventListener("click", function () {
      st.month = iso(new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - 1, 1)));
      renderCalendar();
    });
    next.addEventListener("click", function () {
      st.month = iso(nextFirst);
      renderCalendar();
    });
    head.appendChild(prev);
    head.appendChild(el("strong", { text: monthLabel(first) }));
    head.appendChild(next);
    calEl.appendChild(head);

    var grid = el("div", { class: "cal-grid", role: "grid" });
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach(function (w) { grid.appendChild(el("div", { class: "cal-dow", text: w })); });
    var lead = (d0.getUTCDay() + 6) % 7;
    for (var i = 0; i < lead; i++) grid.appendChild(el("div", { class: "day blank" }));
    var count = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 0)).getUTCDate();
    var picking = st.checkIn && !st.checkOut;
    for (var day = 1; day <= count; day++) {
      var date = first.slice(0, 8) + String(day).padStart(2, "0");
      var cls = "day";
      var ok;
      if (picking && date > st.checkIn) ok = !rangeError(st.checkIn, date) || canStart(date);
      else ok = canStart(date);
      if (date === st.checkIn || date === st.checkOut) cls += " sel";
      else if (st.checkIn && st.checkOut && date > st.checkIn && date < st.checkOut) cls += " inrange";
      var btn = el("button", { type: "button", class: cls, "data-date": date, text: String(day), "aria-label": longDate(date) + (ok ? "" : ", not available") });
      if (!ok && date !== st.checkIn && date !== st.checkOut) btn.disabled = true;
      grid.appendChild(btn);
    }
    grid.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("button[data-date]") : null;
      if (b && !b.disabled) pickDay(b.getAttribute("data-date"));
    });
    calEl.appendChild(grid);
  }

  function pickDay(d) {
    setCalMsg("");
    if (!st.checkIn || st.checkOut || d <= st.checkIn) {
      if (!canStart(d)) { setCalMsg("That day is not available for arrival."); return; }
      st.checkIn = d;
      st.checkOut = null;
      resetQuote();
    } else {
      var err = rangeError(st.checkIn, d);
      if (err) {
        if (canStart(d)) {
          setCalMsg("Some nights in between are taken, so we started a new selection from that day.");
          st.checkIn = d;
          st.checkOut = null;
          resetQuote();
        } else {
          setCalMsg(err);
        }
      } else {
        st.checkOut = d;
        setCalMsg(longDate(st.checkIn) + " to " + longDate(d) + " (" + plural(nights(st.checkIn, d), "night") + ")");
      }
    }
    renderCalendar();
    if (st.checkIn && st.checkOut) requestQuote();
    else if (st.checkIn) setCalMsg("Now choose your departure date.");
  }

  /* ---------- quote ---------- */

  function resetQuote() {
    st.qseq++;
    st.quote = null;
    clear(quoteEl);
    form.hidden = true;
  }

  function requestQuote(silent) {
    var seq = ++st.qseq;
    st.quote = null;
    clear(quoteEl);
    quoteEl.appendChild(el("p", { class: "hint" }, [el("span", { class: "spin" }), " Getting your price..."]));
    return post("/api/quote", { listingId: S.id, checkIn: st.checkIn, checkOut: st.checkOut, guests: st.guests })
      .then(function (q) {
        if (seq !== st.qseq) return;
        st.quote = q;
        st.rate = 0;
        renderQuote();
        showCheckout();
      })
      .catch(function (e) {
        if (seq !== st.qseq) return;
        clear(quoteEl);
        form.hidden = true;
        quoteEl.appendChild(el("p", { class: "err", text: e.message }));
        if (silent) return;
      });
  }

  function plan() { return st.quote && st.quote.ratePlans[st.rate]; }

  function renderQuote() {
    clear(quoteEl);
    var q = st.quote;
    if (!q) return;
    q.ratePlans.forEach(function (p, i) {
      var box = el("div", { class: "rate" + (i === st.rate ? " on" : "") });
      if (q.ratePlans.length > 1) {
        var id = "rate-" + i;
        var input = el("input", { type: "radio", name: "rate", id: id });
        input.checked = i === st.rate;
        input.addEventListener("change", function () { st.rate = i; renderQuote(); updatePayButton(); });
        box.appendChild(el("label", { for: id }, [input, p.name]));
      }
      p.items.forEach(function (it) {
        box.appendChild(el("div", { class: "qline" }, [el("span", { text: it.title }), el("span", { text: money(it.amount) })]));
      });
      box.appendChild(el("div", { class: "qtotal" }, [el("span", { text: "Total (" + plural(q.nights, "night") + ")" }), el("span", { text: money(p.total) })]));
      if (p.cancellation) box.appendChild(el("p", { class: "hint", text: "Cancellation: " + p.cancellation }));
      quoteEl.appendChild(box);
    });
  }

  /* ---------- payment form ---------- */

  function updatePayButton() {
    var p = plan();
    payBtn.textContent = p ? "Pay " + money(p.total) + " and book" : "Book now";
    payBtn.disabled = st.busy || !p || !st.payReady;
  }

  function showCheckout() {
    form.hidden = false;
    updatePayButton();
    if (st.provider) return;
    st.provider = { loading: true };
    getJson("/api/payment?id=" + encodeURIComponent(S.id))
      .then(function (p) { st.provider = p; setupPayment(); })
      .catch(function (e) {
        st.provider = null;
        payUnavailable(e.message);
      });
  }

  function payUnavailable(msg) {
    var box = $("#pay-container");
    clear(box);
    var contact = [S.phone, S.email].filter(Boolean).join(" or ");
    box.appendChild(el("p", { class: "err", text: (msg || "Online payment is not available for this property.") + (contact ? " Please contact us on " + contact + " to book." : " Please contact us to book.") }));
    st.payReady = false;
    updatePayButton();
  }

  function setupPayment() {
    var p = st.provider;
    var box = $("#pay-container");
    clear(box);
    if (!p.supported) { payUnavailable("Card payment is not switched on for this property yet."); return; }
    if (p.mock) {
      var demo = el("div", { class: "demo-card" });
      demo.appendChild(el("p", { class: "hint full", text: "Demo mode. Use any details. Card number 4000 0000 0000 0002 simulates a declined card. Nothing is charged." }));
      demo.appendChild(el("div", { class: "field full" }, [el("label", { for: "d-num", text: "Card number" }), el("input", { id: "d-num", type: "text", inputmode: "numeric", value: "4242 4242 4242 4242" })]));
      demo.appendChild(el("div", { class: "field" }, [el("label", { for: "d-exp", text: "Expiry" }), el("input", { id: "d-exp", type: "text", value: "12/30" })]));
      demo.appendChild(el("div", { class: "field" }, [el("label", { for: "d-csc", text: "CVC" }), el("input", { id: "d-csc", type: "text", value: "123" })]));
      box.appendChild(demo);
      st.payReady = true;
      updatePayButton();
      return;
    }
    loadSdk().then(function (sdk) {
      st.sdk = sdk;
      var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      return sdk.render({
        containerId: "pay-container",
        providerId: p.providerId,
        onStatusChange: function (valid) { st.payValid = !!valid; },
        styles: {
          fontFamily: "Figtree, system-ui, sans-serif",
          borderRadius: "6px",
          colorText: dark ? "#E7EFEB" : "#13241F",
          colorFormBackground: dark ? "#16231F" : "#FFFFFF",
          colorInputBackground: dark ? "#0E1815" : "#F2F5F3",
          colorBorder: dark ? "#26362F" : "#D5DDD9",
        },
      });
    }).then(function () {
      st.payReady = true;
      updatePayButton();
    }).catch(function () {
      payUnavailable("The secure payment form could not load.");
    });
  }

  function loadSdk() {
    return new Promise(function (resolve, reject) {
      if (window.guestyTokenization) { resolve(window.guestyTokenization); return; }
      var s = document.createElement("script");
      // Guesty requires this script to be loaded from their server, never copied or bundled.
      s.src = "https://pay.guesty.com/tokenization/v3/init.js";
      s.onload = function () { window.guestyTokenization ? resolve(window.guestyTokenization) : reject(new Error("sdk")); };
      s.onerror = function () { reject(new Error("sdk")); };
      document.head.appendChild(s);
    });
  }

  /* ---------- booking ---------- */

  function setBusy(on, text) {
    st.busy = on;
    statusEl.textContent = on ? text || "" : "";
    updatePayButton();
    if (on) payBtn.textContent = "Please wait...";
  }
  function showErr(t) { errEl.textContent = t || ""; }
  function val(id) { return ($("#" + id).value || "").trim(); }

  function formError() {
    if (!val("b-first")) return "Please enter your first name.";
    if (!val("b-last")) return "Please enter your last name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val("b-email"))) return "Please enter a valid email address.";
    if (!$("#b-terms").checked) return "Please accept the booking terms to continue.";
    return "";
  }

  form.addEventListener("submit", function (e) { e.preventDefault(); book(); });

  function messageOf(e) {
    if (e && typeof e === "object" && e.message) return String(e.message);
    return typeof e === "string" ? e : "Something went wrong. Please try again.";
  }

  function book() {
    if (st.busy) return;
    showErr("");
    var p = plan();
    if (!p || !st.quote) { showErr("Please choose your dates first."); return; }
    var bad = formError();
    if (bad) { showErr(bad); return; }
    var guest = { firstName: val("b-first"), lastName: val("b-last"), email: val("b-email"), phone: val("b-phone") };
    var charged = false;
    var quote = st.quote;
    setBusy(true, "Checking your card...");

    var getToken;
    if (st.provider && st.provider.mock) {
      var num = ($("#d-num").value || "").replace(/\s/g, "");
      getToken = Promise.resolve(num === "4000000000000002" ? "mock-pm-decline" : "mock-pm-ok");
    } else {
      if (!st.payValid && st.sdk && st.sdk.validate) st.sdk.validate();
      getToken = st.sdk.submit({
        amount: p.total,
        currency: quote.currency,
        listingId: S.id,
        quoteId: quote.quoteId,
        guest: guest,
        method: "verify_no_3ds",
      }).then(function (pm) {
        if (!pm || !pm._id) throw new Error("We could not read your card details. Please try again.");
        return pm._id;
      });
    }

    getToken.then(function (pmId) {
      setBusy(true, "Confirming your booking...");
      charged = true;
      return post("/api/book", {
        quoteId: quote.quoteId,
        ratePlanId: p.id,
        paymentMethodId: pmId,
        guest: guest,
        acceptedTerms: $("#b-terms").checked,
        marketing: $("#b-marketing").checked,
      });
    }).then(function (r) {
      if (r.status !== "needs_3ds") return r;
      setBusy(true, "Confirm the payment with your bank...");
      return st.sdk.handle3DSChallenge({ threeDSChallenge: r.threeDSChallenge }).then(function (result) {
        setBusy(true, "Confirming your booking...");
        return post("/api/verify", { reservationId: r.reservationId, paymentId: r.paymentId, threeDSResult: result });
      });
    }).then(function (r) {
      if (r.status === "confirmed") showDone(r, quote, p, guest);
      else throw new Error("We could not confirm your booking. You have not been booked.");
    }).catch(function (e) {
      showErr(messageOf(e));
      setBusy(false);
      // A quote can only be used once, so after a charge attempt fetch a fresh price for the next try.
      if (charged && st.checkIn && st.checkOut) requestQuote(true);
    });
  }

  function showDone(r, quote, p, guest) {
    setBusy(false);
    var done = $("#done");
    clear(done);
    done.appendChild(el("h3", { text: "Booking confirmed" }));
    if (r.confirmationCode) {
      done.appendChild(el("div", { class: "lbl", text: "Confirmation code" }));
      done.appendChild(el("div", { class: "code", text: r.confirmationCode }));
    }
    done.appendChild(el("p", { text: S.title + ", " + longDate(quote.checkIn) + " to " + longDate(quote.checkOut) + " (" + plural(quote.nights, "night") + ", " + plural(quote.guests, "guest") + ")." }));
    done.appendChild(el("p", { text: "Total paid: " + money(p.total) + ". Please keep your confirmation code for your records." }));
    var contact = [S.phone, S.email].filter(Boolean).join(" or ");
    if (contact) done.appendChild(el("p", { class: "hint", text: "Questions about your stay? Contact us on " + contact + "." }));
    done.hidden = false;
    form.hidden = true;
    clear(quoteEl);
    clear(calEl);
    setCalMsg("");
    guestsEl.parentNode.hidden = true;
    done.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ---------- start ---------- */

  function loadCalendar() {
    var to = addDays(S.today, 540);
    return getJson("/api/calendar?id=" + encodeURIComponent(S.id) + "&from=" + S.today + "&to=" + to)
      .then(function (data) {
        (data.days || []).forEach(function (d) { st.days[d.date] = d; });
        st.calendarEnd = to;
        renderCalendar();
        var pre = S.prefill || {};
        if (pre.checkIn && pre.checkOut && canStart(pre.checkIn) && !rangeError(pre.checkIn, pre.checkOut)) {
          st.checkIn = pre.checkIn;
          st.checkOut = pre.checkOut;
          st.month = pre.checkIn.slice(0, 8) + "01";
          renderCalendar();
          setCalMsg(longDate(st.checkIn) + " to " + longDate(st.checkOut) + " (" + plural(nights(st.checkIn, st.checkOut), "night") + ")");
          requestQuote();
        }
      })
      .catch(function (e) {
        clear(calEl);
        var contact = [S.phone, S.email].filter(Boolean).join(" or ");
        calEl.appendChild(el("p", { class: "err", text: "Availability could not be loaded. " + (contact ? "Please contact us on " + contact + "." : "Please try again shortly.") }));
        guestsEl.parentNode.hidden = true;
      });
  }

  loadCalendar();
})();
