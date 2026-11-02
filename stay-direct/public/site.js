/* Small page enhancements. Everything here is optional; the pages work without it. */
(function () {
  "use strict";

  // Departure date cannot be before arrival.
  var inEl = document.getElementById("f-in");
  var outEl = document.getElementById("f-out");
  if (inEl && outEl) {
    var sync = function () {
      if (!inEl.value) return;
      var d = new Date(inEl.value + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      var min = d.toISOString().slice(0, 10);
      outEl.min = min;
      if (outEl.value && outEl.value < min) outEl.value = min;
    };
    inEl.addEventListener("change", sync);
    sync();
  }

  // Photo gallery thumbnails.
  var main = document.getElementById("main-photo");
  var thumbs = document.querySelectorAll(".thumbs button");
  if (main && thumbs.length) {
    thumbs.forEach(function (btn) {
      btn.addEventListener("click", function () {
        main.src = btn.getAttribute("data-photo");
        thumbs.forEach(function (b) { b.removeAttribute("aria-current"); });
        btn.setAttribute("aria-current", "true");
      });
    });
  }
})();
