"use client";

import { cn } from "@/lib/utils";

export type Choice = { value: string; label: string; /** Cor de identidade (ex.: área). */ dot?: string };

type Props = {
  id: string;
  name: string;
  legend: string;
  options: Choice[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
  /** Legenda só para leitores de tela (quando o contexto já diz o que é). */
  hideLegend?: boolean;
  className?: string;
};

/** Escolha única em botões (rádios de formulário): um toque, sem abrir lista. */
export function ChoiceChips({ id, name, legend, options, value, onChange, error, hideLegend, className }: Props) {
  return (
    <fieldset className={cn("flex flex-col gap-1.5", className)} data-choice={name}>
      <legend className={cn("mb-1.5 text-sm font-medium", hideLegend && "sr-only")}>{legend}</legend>
      {/* Com erro, o grupo recebe o foco (tabIndex -1) e anuncia a mensagem. */}
      <div
        role="radiogroup"
        aria-label={legend}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-erro` : undefined}
        tabIndex={-1}
        className="flex flex-wrap gap-1.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border bg-card px-3.5 text-sm font-medium has-focus-visible:ring-2 has-focus-visible:ring-ring",
              value === option.value ? "border-primary bg-primary text-primary-foreground" : "text-foreground hover:bg-accent",
              error && value !== option.value && "border-destructive/60",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.dot && <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full ring-1 ring-white/70" style={{ backgroundColor: option.dot }} />}
            {option.label}
          </label>
        ))}
      </div>
      {error && (
        <p id={`${id}-erro`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
