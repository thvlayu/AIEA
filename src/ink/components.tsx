import { useEffect, useState, type ReactNode } from "react";
import { Box, Text, useInput } from "ink";

export const HEART_RED = "#FF2D55";
export const RED_DEEP = "#C81E1E";
export const WHITE = "#F2F3F5";
export const GRAY = "#8B909A";

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export function lerpColor(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const f = Math.max(0, Math.min(1, t));
  const mix = ca.map((v, i) => Math.round(v + (cb[i]! - v) * f));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function GradientText({
  text,
  from = HEART_RED,
  to = RED_DEEP,
  bold,
}: {
  text: string;
  from?: string;
  to?: string;
  bold?: boolean;
}) {
  const chars = [...text];
  const n = Math.max(1, chars.length - 1);
  return (
    <Text bold={bold}>
      {chars.map((c, i) => (
        <Text key={i} color={lerpColor(from, to, chars.length === 1 ? 0 : i / n)}>
          {c}
        </Text>
      ))}
    </Text>
  );
}

export function GradientBar({ frac, width = 20 }: { frac: number; width?: number }) {
  const f = Math.max(0, Math.min(1, frac));
  const filled = Math.round(f * width);
  const cells: ReactNode[] = [];
  for (let i = 0; i < width; i++) {
    const t = width === 1 ? 0 : i / (width - 1);
    cells.push(
      <Text key={i} color={i < filled ? lerpColor(HEART_RED, RED_DEEP, t) : undefined} dimColor={i >= filled}>
        {i < filled ? "█" : "░"}
      </Text>,
    );
  }
  return <Text>{cells}</Text>;
}

export function Arrow({ active }: { active?: boolean }) {
  return (
    <Text color={active === false ? GRAY : WHITE} bold={active !== false}>
      {active === false ? " " : "❯"}
    </Text>
  );
}

const FLOW_STOPS = [HEART_RED, RED_DEEP, WHITE];

function sampleCycle(p: number): string {
  const n = FLOW_STOPS.length;
  const x = ((p % 1) + 1) % 1;
  const seg = x * n;
  const i = Math.floor(seg);
  const t = seg - i;
  return lerpColor(FLOW_STOPS[i % n]!, FLOW_STOPS[(i + 1) % n]!, t);
}

export function FlowText({
  text,
  period = 2.5,
  bold,
}: {
  text: string;
  period?: number;
  bold?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setOffset((o) => (o + 0.06) % 1), 120);
    return () => clearInterval(t);
  }, []);
  const chars = [...text];
  return (
    <Text bold={bold}>
      {chars.map((c, i) => (
        <Text key={i} color={sampleCycle(i / Math.max(1, chars.length) * period + offset)}>
          {c}
        </Text>
      ))}
    </Text>
  );
}

export function SelectList({
  title,
  options,
  subs,
  onDone,
  onCancel,
  footer,
}: {
  title: string;
  options: string[];
  subs?: string[];
  onDone: (index: number) => void;
  onCancel?: () => void;
  footer?: string;
}) {
  const [sel, setSel] = useState(0);
  useInput((input, key) => {
    if (key.upArrow) setSel((s) => (s + options.length - 1) % options.length);
    else if (key.downArrow) setSel((s) => (s + 1) % options.length);
    else if (key.return) onDone(sel);
    else if (key.escape) onCancel?.();
  });
  return (
    <Box flexDirection="column">
      <Text bold color="white">
        {title}
      </Text>
      {options.map((o, i) => (
        <Box key={`${o}-${i}`} gap={1}>
          <Arrow active={i === sel} />
          <Text color={i === sel ? WHITE : GRAY} bold={i === sel}>
            {o}
          </Text>
          {subs?.[i] ? <Text dimColor>{subs[i]}</Text> : null}
        </Box>
      ))}
      <Text dimColor>{footer ?? "arrows move | enter select | esc back"}</Text>
    </Box>
  );
}

export interface FormField {
  key: string;
  label: string;
  kind: "number" | "choice";
  initial: string;
  choices?: string[];
  hint?: string;
}

function pad(s: string, w: number): string {
  return s.length <= w ? s.padEnd(w) : s.slice(0, w - 3) + "...";
}

export function ConfigForm({
  title,
  fields,
  onConfirm,
  onCancel,
  footer,
}: {
  title: string;
  fields: FormField[];
  onConfirm: (values: Record<string, string>) => void;
  onCancel: () => void;
  footer?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.initial])),
  );
  const [active, setActive] = useState(0);

  useInput((input, key) => {
    const field = fields[active];
    if (!field) return;
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setActive((a) => (a + fields.length - 1) % fields.length);
      return;
    }
    if (key.downArrow || key.tab) {
      setActive((a) => (a + 1) % fields.length);
      return;
    }
    if (field.kind === "choice") {
      if (key.leftArrow || key.rightArrow) {
        const choices = field.choices ?? [];
        if (choices.length === 0) return;
        const cur = Math.max(0, choices.indexOf(values[field.key] ?? choices[0]!));
        const dir = key.rightArrow ? 1 : -1;
        const next = choices[(cur + dir + choices.length) % choices.length]!;
        setValues((v) => ({ ...v, [field.key]: next }));
      }
      if (key.return) {
        if (active === fields.length - 1) onConfirm(values);
        else setActive((a) => a + 1);
      }
      return;
    }
    if (key.backspace) {
      setValues((v) => ({ ...v, [field.key]: (v[field.key] ?? "").slice(0, -1) }));
      return;
    }
    if (/^[0-9.-]$/.test(input)) {
      setValues((v) => ({ ...v, [field.key]: (v[field.key] ?? "") + input }));
      return;
    }
    if (key.return) {
      if (active === fields.length - 1) onConfirm(values);
      else setActive((a) => a + 1);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color="white">
        {title}
      </Text>
      {fields.map((f, i) => (
        <Box key={f.key} gap={1}>
          <Arrow active={i === active} />
          <Box width={20}>
            <Text color={i === active ? WHITE : GRAY} bold={i === active}>
              {pad(f.label, 20)}
            </Text>
          </Box>
          <Text color={i === active ? HEART_RED : GRAY}>
            {f.kind === "choice" ? `< ${values[f.key] ?? "-"} >` : `${values[f.key] ?? ""}${i === active ? "_" : ""}`}
          </Text>
          {f.hint ? <Text dimColor>{f.hint}</Text> : null}
        </Box>
      ))}
      <Text dimColor>{footer ?? "type to edit | arrows move | enter next/confirm | esc back"}</Text>
    </Box>
  );
}

const SPINNER_FRAMES = ["·  ", "·· ", "···"];

export function Spinner({ label }: { label: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % SPINNER_FRAMES.length), 110);
    return () => clearInterval(t);
  }, []);
  return (
    <Box gap={1}>
      <GradientText text={SPINNER_FRAMES[i]!.padEnd(3, " ")} />
      <Text color="white">{label}</Text>
    </Box>
  );
}

export interface TableColumn {
  key: string;
  label: string;
  width: number;
  align?: "left" | "right";
}

function fmtCell(value: string, col: TableColumn): string {
  return col.align === "right" ? value.padStart(col.width).slice(-col.width) : pad(value, col.width);
}

export function Table({
  columns,
  rows,
  empty,
}: {
  columns: TableColumn[];
  rows: Array<Record<string, string>>;
  empty?: string;
}) {
  if (rows.length === 0) return <Text dimColor>{empty ?? "(no rows yet)"}</Text>;
  return (
    <Box flexDirection="column">
      <Text bold color="white">
        {columns.map((c) => fmtCell(c.label, c)).join("  ")}
      </Text>
      <Text dimColor>{columns.map((c) => "-".repeat(c.width)).join("  ")}</Text>
      {rows.map((r, ri) => (
        <Text key={ri} color={ri === rows.length - 1 ? WHITE : GRAY}>
          {columns.map((c) => fmtCell(r[c.key] ?? "-", c)).join("  ")}
        </Text>
      ))}
    </Box>
  );
}

export function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <Box gap={1}>
      <Box width={20}>
        <Text color={GRAY}>{pad(k, 20)}</Text>
      </Box>
      <Text color="white">{v}</Text>
    </Box>
  );
}

export function scoreColor(score: number): string {
  return score >= 0.6 ? WHITE : score >= 0.35 ? GRAY : RED_DEEP;
}

export interface CommandHint {
  name: string;
  usage: string;
}

export function PromptInput({
  commands,
  onSubmit,
  placeholder,
}: {
  commands: CommandHint[];
  onSubmit: (text: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [hist, setHist] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [blink, setBlink] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setBlink((b) => !b), 530);
    return () => clearInterval(t);
  }, []);

  useInput((input, key) => {
    if (key.return) {
      const text = value.trim();
      if (text) {
        setHist((h) => [...h, text]);
        setHistIdx(null);
      }
      setValue("");
      onSubmit(text);
      return;
    }
    if (key.upArrow) {
      if (hist.length === 0) return;
      const idx = histIdx === null ? hist.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(idx);
      setValue(hist[idx] ?? "");
      return;
    }
    if (key.downArrow) {
      if (histIdx === null) return;
      const idx = histIdx + 1;
      if (idx >= hist.length) {
        setHistIdx(null);
        setValue("");
      } else {
        setHistIdx(idx);
        setValue(hist[idx] ?? "");
      }
      return;
    }
    if (key.escape) {
      setValue("");
      setHistIdx(null);
      return;
    }
    if (key.backspace) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.return && !key.upArrow && !key.downArrow && !key.tab) {
      setValue((v) => v + input);
    }
  });

  const first = (value.split(/\s+/)[0] ?? "").toLowerCase();
  const matches =
    first.length > 0 ? commands.filter((c) => c.name.startsWith(first) && c.name !== first) : [];
  const showSug = matches.length > 0;

  return (
    <Box flexDirection="column">
      {showSug
        ? matches.slice(0, 4).map((c) => (
            <Box key={c.name} gap={1} paddingLeft={1}>
              <Text color={GRAY}>{c.name}</Text>
              <Text dimColor>{c.usage.slice(c.name.length)}</Text>
            </Box>
          ))
        : null}
      <Box borderStyle="round" borderColor="#3a3d44" paddingX={1} width="100%">
        <Text color={WHITE} bold>
          ❯{" "}
        </Text>
        {value.length === 0 && placeholder ? <Text dimColor>{placeholder}</Text> : <Text color="white">{value}</Text>}
        <Text inverse={blink} color={blink ? "black" : WHITE}>
          {" "}
        </Text>
      </Box>
    </Box>
  );
}
