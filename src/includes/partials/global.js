function initThemeHandler() {
  const selectEl = document.querySelector('select[id="theme"]');
  const prefersDarkScheme = window.matchMedia(
    "(prefers-color-scheme: dark)",
  ).matches;
  const preferredTheme = prefersDarkScheme ? "dark" : "light";
  const savedThemeConfig = localStorage.getItem("theme");

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const style = getComputedStyle(document.body);

  selectEl.value = savedThemeConfig || "system";

  if (savedThemeConfig === "dark" || savedThemeConfig === "light") {
    setTheme(savedThemeConfig);
  } else {
    setTheme(preferredTheme);
  }

  selectEl.addEventListener("change", () => {
    if (selectEl.value === "system") {
      setTheme(preferredTheme);
    } else {
      setTheme(selectEl.value);
    }

    localStorage.setItem("theme", selectEl.value);
  });

  function setTheme(theme) {
    if (theme === "dark") {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }

    const currentBackgroundColor = style.getPropertyValue("--clr-background");
    themeMeta.setAttribute("content", currentBackgroundColor);
  }
}

function initFontHandler() {
  const style = getComputedStyle(document.body);
  const sansSerif = style.getPropertyValue("--ff-sans-serif");
  const serif = style.getPropertyValue("--ff-serif");

  const savedFont = localStorage.getItem("font");
  const selectEl = document.querySelector('select[id="font"]');

  if (savedFont === "serif") {
    setFont(savedFont);
    selectEl.value = savedFont;
  }

  selectEl.addEventListener("change", () => {
    setFont(selectEl.value);
    localStorage.setItem("font", selectEl.value);
  });

  function setFont(font) {
    if (font === "serif") {
      document.body.style.fontFamily = serif;
    } else {
      document.body.style.fontFamily = sansSerif;
    }
  }
}

function initEmailObfuscation() {
  const elements = document.querySelectorAll("[data-email-u][data-email-d]");
  elements.forEach((el) => {
    try {
      const u = atob(el.getAttribute("data-email-u"));
      const d = atob(el.getAttribute("data-email-d"));
      const email = `${u}@${d}`;
      if (el.getAttribute("data-email-text-only") === "true") {
        el.textContent = email;
      } else {
        const link = document.createElement("a");
        link.href = `mailto:${email}`;
        link.textContent = email;
        el.innerHTML = "";
        el.appendChild(link);
      }
    } catch (e) {
      // Keep fallback text
    }
  });
}

initThemeHandler();
initFontHandler();
initEmailObfuscation();

