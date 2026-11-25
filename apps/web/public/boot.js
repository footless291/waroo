// Runs before the first paint (loaded from index.html): standalone mode, the
// chosen theme and the app's language, so nothing flashes or shows wrong glyphs.
// A file rather than an inline script, so the Content-Security-Policy can
// allow only scripts from this site.
if (matchMedia('(display-mode: standalone)').matches || navigator.standalone)
  document.documentElement.classList.add('standalone')
// Light or dark chosen in the app (lib/theme.ts), before the first paint.
try {
  var theme = localStorage.getItem('waroo-theme')
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme)
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      m.content = theme === 'dark' ? '#16121f' : '#fff5ee'
    })
  }
} catch (e) {}
// The app's language (lib/i18n.ts), so Japanese text gets Japanese glyphs from the start.
try {
  var lang = localStorage.getItem('waroo-language')
  if (lang !== 'en' && lang !== 'ja') {
    lang = 'en'
    var tags = navigator.languages || [navigator.language]
    for (var i = 0; i < tags.length; i++) {
      var base = String(tags[i]).toLowerCase().split('-')[0]
      if (base === 'ja' || base === 'en') { lang = base; break }
    }
  }
  document.documentElement.lang = lang
} catch (e) {}
