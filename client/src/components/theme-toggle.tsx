import { useState } from "react";
import { Moon, Sun } from "lucide-react";

function getStoredTheme(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem('linen-theme');
    if (stored === 'dark') return 'dark';
  } catch {}
  return 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getStoredTheme);

  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('linen-theme', next);
    setTheme(next);
  };

  return (
    <button
      onClick={toggle}
      className="theme-toggle-btn"
      title="Cambiar tema"
      data-testid="button-theme-toggle"
    >
      {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
