import { Palette } from "lucide-react";

export const accents = {
  mono: { label: "黑白", swatch: "#eeeeee" },
  blue: { label: "湖蓝", swatch: "#a5c6e0" },
  violet: { label: "鸢尾紫", swatch: "#c8b9e8" },
  rose: { label: "玫瑰粉", swatch: "#e2b4cb" },
} as const;

export type Accent = keyof typeof accents;
export type Appearance = "system" | "light" | "dark";
export type Preferences = { appearance: Appearance; accent: Accent };

export function normalizePreferences(value?: Partial<Preferences>): Preferences {
  return {
    appearance: value?.appearance === "light" || value?.appearance === "dark"
      ? value.appearance
      : "system",
    accent: value?.accent && Object.hasOwn(accents, value.accent) ? value.accent : "mono",
  };
}

export function AppearanceMenu({
  preferences,
  onChange,
  ready,
}: {
  preferences: Preferences;
  onChange: (preferences: Preferences) => void;
  ready: boolean;
}) {
  return (
    <>
      <button
        type="button"
        className="appearance-trigger"
        title="外观与强调色"
        aria-label="外观与强调色"
        popoverTarget="appearance-menu"
        disabled={!ready}
      >
        <Palette size={17} />
      </button>
      <section id="appearance-menu" className="appearance-menu" popover="auto" aria-label="外观设置">
        <h2>外观</h2>
        <label className="appearance-mode">
          主题
          <select
            aria-label="外观"
            value={preferences.appearance}
            onChange={(e) => onChange({ ...preferences, appearance: e.target.value as Appearance })}
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
        <fieldset className="accent-choices">
          <legend>强调色</legend>
          {Object.entries(accents).map(([id, { label, swatch }]) => (
            <label key={id}>
              <input
                type="radio"
                name="interface-accent"
                value={id}
                checked={preferences.accent === id}
                onChange={() => onChange({ ...preferences, accent: id as Accent })}
              />
              <span>
                <i
                  className={id === "mono" ? "mono-swatch" : undefined}
                  style={{ backgroundColor: swatch }}
                  aria-hidden="true"
                />
                {label}
              </span>
            </label>
          ))}
        </fieldset>
      </section>
    </>
  );
}
