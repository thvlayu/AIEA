import { useEffect, useState, type ReactNode } from "react";
import { Box, Text, useInput } from "ink";

export function Frame({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: string;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text bold color="cyan">
        {title}
      </Text>
      {children}
      {footer ? <Text dimColor>{footer}</Text> : null}
    </Box>
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
    <Frame title={title} footer={footer ?? "arrows move | enter select | esc back"}>
      {options.map((o, i) => (
        <Box key={`${o}-${i}`} gap={1}>
          <Text color={i === sel ? "cyan" : undefined}>{i === sel ? ">" : " "}</Text>
          <Text bold={i === sel} color={i === sel ? "cyan" : undefined}>
            {o}
          </Text>
          {subs?.[i] ? <Text dimColor>{subs[i]}</Text> : null}
        </Box>
      ))}
    </Frame>
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
    <Frame title={title} footer={footer ?? "type to edit | arrows move | enter next/confirm | esc back"}>
      {fields.map((f, i) => (
        <Box key={f.key} gap={1}>
          <Box width={22}>
            <Text bold={i === active} color={i === active ? "cyan" : undefined}>
              {pad(f.label, 22)}
            </Text>
          </Box>
          <Box borderStyle={i === active ? "single" : undefined} borderColor="cyan" paddingX={i === active ? 1 : 0}>
            <Text>{f.kind === "choice" ? `< ${values[f.key] ?? "-"} >` : `${values[f.key] ?? ""}_`}</Text>
          </Box>
          {f.hint ? <Text dimColor>{f.hint}</Text> : null}
        </Box>
      ))}
    </Frame>
  );
}

const SPINNER_FRAMES = ["|", "/", "-", "\\"];

export function Spinner({ label }: { label: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % SPINNER_FRAMES.length), 90);
    return () => clearInterval(t);
  }, []);
  return (
    <Text color="yellow">
      {SPINNER_FRAMES[i]} {label}
    </Text>
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
      <Text bold>{columns.map((c) => fmtCell(c.label, c)).join("  ")}</Text>
      <Text dimColor>{columns.map((c) => "-".repeat(c.width)).join("  ")}</Text>
      {rows.map((r, ri) => (
        <Text key={ri}>{columns.map((c) => fmtCell(r[c.key] ?? "-", c)).join("  ")}</Text>
      ))}
    </Box>
  );
}

export function Bar({ frac, width = 20, color = "cyan" }: { frac: number; width?: number; color?: string }) {
  const f = Math.max(0, Math.min(1, frac));
  const filled = Math.round(f * width);
  return (
    <Text color={color}>
      {"█".repeat(filled)}
      {"░".repeat(Math.max(0, width - filled))}
    </Text>
  );
}

export function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <Box>
      <Box width={20}>
        <Text dimColor>{pad(k, 20)}</Text>
      </Box>
      <Text>{v}</Text>
    </Box>
  );
}

export function scoreColor(score: number): string {
  return score >= 0.6 ? "green" : score >= 0.35 ? "yellow" : "red";
}
