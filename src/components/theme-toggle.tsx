
"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const [theme, setTheme] = React.useState<string | null>(null);

  React.useEffect(() => {
    // This effect runs after the inline script in layout.tsx has already set the initial theme class.
    // Its main job is to sync React state with localStorage and provide the toggle functionality.
    const storedTheme = localStorage.getItem("theme");
    // The inline script ensures localStorage.getItem('theme') will be 'dark' or user's preference.
    setTheme(storedTheme || "dark"); 
  }, []);

  const toggleTheme = () => {
    if (!theme) return; // Should ideally not happen after mount

    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  // Prevents rendering the button until the theme is determined, avoiding hydration mismatch/flash.
  if (theme === null) {
    return <div style={{ width: '2.5rem', height: '2.5rem' }} />; // Placeholder for button size
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
