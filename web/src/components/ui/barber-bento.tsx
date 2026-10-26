"use client";

/* Página inicial do painel: layout "bento" derivado de web3-bento.tsx,
   na paleta preto e dourado e alimentado pelos dados reais da barbearia. */

import * as React from "react";
import { Activity, CalendarCheck, Crown, Scissors, Undo2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Tipos                                                              */
/* ------------------------------------------------------------------ */

export interface BarberDay {
  date: string;
  dia: number;
  dia_semana: string;
  util: boolean;
  total: number;
  servicos: number;
  produtos: number;
  novas_assinaturas: number;
  sva: number;
  recorrencia: number;
}

export interface BarberPeriod {
  inicio: number;
  termino: number;
  dia_apuracao: number;
  meta: number;
  realizado: number;
  restante: number;
  percentual: number;
  dias_uteis_restantes: number;
  restante_por_dia: number;
  media_diaria: number;
  projecao: number;
  maior_dia: { date: string; valor: number } | null;
  menor_dia: { date: string; valor: number } | null;
  sva?: number;
  assinaturas?: number;
}

export interface BarberPro {
  id: number;
  name: string;
  faturamento: number;
  clientes: number;
  ticket: number;
  comissao: number;
}

export interface BarberActivity {
  id: string;
  kind: "venda" | "assinatura" | "cancelamento" | "fechamento" | "mensal" | "outro";
  title: string;
  detail: string;
  amount: string;
  status: "processado" | "duplicado" | "erro";
  time: string;
}

export interface BarberBentoProps {
  userName: string;
  unidade: string;
  mesNome: string;
  ano: number;
  diaApuracao: number;
  dias: BarberDay[];
  mensal: BarberPeriod;
  quinzenas: [BarberPeriod, BarberPeriod];
  quinzenaAtual: 1 | 2;
  /** Variação % do faturamento vs mês anterior (null = sem comparativo) */
  variacao: number | null;
  composicao: { label: string; value: number }[];
  profissionais: BarberPro[];
  atividade: BarberActivity[];
  /** Base do clube de assinatura (do relatório de assinantes do CashBarber) */
  assinaturas?: { total: number; emDia: number; pendentes: number; novas?: number | null; cancelamentos?: number | null } | null;
  /** Dourado principal e bronze secundário */
  accent?: string;
  accent2?: string;
  onNavigate?: (path: string) => void;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const INK = "oklch(0.18 0.02 75)"; // texto sobre dourado

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const BRL2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUM1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const brl = (v: number) => BRL.format(v || 0);
const brl2 = (v: number) => BRL2.format(v || 0);
const brlShort = (v: number) => {
  const n = v || 0;
  if (Math.abs(n) >= 1e6) return `R$ ${NUM1.format(n / 1e6)} mi`;
  if (Math.abs(n) >= 1e3) return `R$ ${NUM1.format(n / 1e3)} mil`;
  return brl(n);
};
const pct = (v: number) => `${NUM1.format(v || 0)}%`;
const ddmm = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

function useReducedMotion() {
  const [r, setR] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const u = () => setR(mq.matches);
    u();
    mq.addEventListener("change", u);
    return () => mq.removeEventListener("change", u);
  }, []);
  return r;
}

function useMounted() {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

function useCountUp(target: number, enabled: boolean, duration = 1300) {
  const [v, setV] = React.useState(enabled ? 0 : target);
  React.useEffect(() => {
    if (!enabled) return setV(target);
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setV(target * (1 - Math.pow(1 - p, 4)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, duration]);
  return v;
}

function smooth(pts: ReadonlyArray<readonly [number, number]>) {
  return pts
    .map(([x, y], i) => {
      if (i === 0) return `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      const [px, py] = pts[i - 1];
      const m = (px + x) / 2;
      return `C ${m.toFixed(1)} ${py.toFixed(1)}, ${m.toFixed(1)} ${y.toFixed(1)}, ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/* ------------------------------------------------------------------ */
/*  Estrutura                                                          */
/* ------------------------------------------------------------------ */

function Tile({ title, action, className, children }: { title?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("relative flex min-w-0 flex-col overflow-hidden rounded-[26px] border border-border bg-card p-5 text-card-foreground", className)}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h3 className="text-[13px] font-medium text-muted-foreground">{title}</h3>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function Pills<T extends string>({ value, options, onChange, label }: { value: T; options: T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-full px-2.5 py-1 font-mono text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            o === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="grid flex-1 place-items-center py-6 text-center text-[12px] text-muted-foreground">{children}</div>
);

/* ------------------------------------------------------------------ */
/*  Hero: saudação, faturamento do mês e faturamento dia a dia          */
/* ------------------------------------------------------------------ */

function HeroTile({ p, accent, accent2, reduced }: { p: BarberBentoProps; accent: string; accent2: string; reduced: boolean }) {
  const mounted = useMounted();
  const shown = useCountUp(p.mensal.realizado, !reduced);
  const [hover, setHover] = React.useState<number | null>(null);
  const max = Math.max(...p.dias.map((d) => d.total), 1);
  const avg = p.mensal.media_diaria;
  const h = new Date().getHours();
  const greet = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const first = p.userName.split(" ")[0];
  const v = p.variacao;
  const hd = hover !== null ? p.dias[hover] : null;

  return (
    <Tile className="@xl:col-span-2 @4xl:col-span-2 @4xl:col-start-1 @4xl:row-start-1">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] @xl:text-[34px]">
            {greet}, <span style={{ color: accent }}>{first}</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Seu mês na {p.unidade} em um só lugar.
          </p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-[12px] text-muted-foreground">Faturamento de {p.mesNome}</p>
          <p className="font-mono text-[32px] font-semibold leading-none tracking-[-0.04em] tabular-nums @xl:text-[38px]">{brl(shown)}</p>
          <p className="mt-1.5 font-mono text-[12px] tabular-nums">
            {v === null ? (
              <span className="text-muted-foreground">sem comparativo</span>
            ) : (
              <span style={{ color: v >= 0 ? accent : accent2 }}>
                {v >= 0 ? "▲ +" : "▼ −"}
                {pct(Math.abs(v))}
              </span>
            )}
            <span className="text-muted-foreground"> · vs mês anterior</span>
          </p>
          {p.assinaturas && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[12.5px]">
              <Crown size={14} strokeWidth={2} style={{ color: accent }} aria-hidden />
              <span className="font-mono font-semibold tabular-nums">{p.assinaturas.total.toLocaleString("pt-BR")}</span>
              <span className="text-muted-foreground">assinaturas</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono tabular-nums">{p.assinaturas.emDia.toLocaleString("pt-BR")}</span>
              <span className="text-muted-foreground">em dia</span>
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-1 flex-col">
        <div className="flex flex-1 items-end gap-[3px]" style={{ minHeight: 72 }} onPointerLeave={() => setHover(null)}>
          {p.dias.map((d, i) => {
            const future = d.dia > p.diaApuracao;
            const above = d.total >= avg && d.total > 0;
            const height = d.total ? 10 + (d.total / max) * 90 : 5;
            return (
              <button
                key={d.date}
                type="button"
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${ddmm(d.date)} ${d.dia_semana}: ${brl2(d.total)}`}
                className="relative flex-1 rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{
                  height: mounted ? `${height}%` : "5%",
                  background: future || !d.total ? "var(--color-muted)" : above ? accent : accent2,
                  opacity: hover === null ? (future ? 0.6 : 0.45 + (d.total / max) * 0.55) : hover === i ? 1 : 0.25,
                  transition: `height 900ms ${EASE} ${i * 16}ms, opacity 200ms ease`,
                }}
              />
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
          <span>{ddmm(p.dias[0].date)}</span>
          <span className="truncate text-foreground" aria-live="polite">
            {hd ? `${ddmm(hd.date)} · ${hd.dia_semana} · ${brl2(hd.total)}` : "Faturamento diário · dourado = acima da média"}
          </span>
          <span>{ddmm(p.dias[p.dias.length - 1].date)}</span>
        </div>
      </div>
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Equipe: pilha de cartões (clique para trazer à frente)             */
/* ------------------------------------------------------------------ */

interface ProCard {
  pro: BarberPro;
  rank: number;
  color: string;
  color2: string;
  ink: string;
}

const CARD_SKINS = [
  { color: "oklch(0.86 0.12 88)", color2: "oklch(0.64 0.13 68)", ink: INK }, // ouro
  { color: "oklch(0.3 0.012 80)", color2: "oklch(0.14 0.005 80)", ink: "oklch(0.86 0.1 85)" }, // carbono
  { color: "oklch(0.7 0.1 55)", color2: "oklch(0.45 0.08 45)", ink: "oklch(0.97 0.02 80)" }, // bronze
  { color: "oklch(0.9 0.03 85)", color2: "oklch(0.72 0.04 80)", ink: INK }, // champanhe
];

function CardFace({ c, glare }: { c: ProCard; glare: number }) {
  return (
    <>
      <span
        aria-hidden
        className="absolute inset-0 overflow-hidden rounded-[12px]"
        style={{
          backgroundImage: [
            "linear-gradient(180deg, oklch(1 0 0 / 0.25) 0%, transparent 34%)",
            `radial-gradient(110% 90% at 100% 0%, ${c.color2} 0%, transparent 60%)`,
            `linear-gradient(135deg, ${c.color} 0%, ${c.color2} 100%)`,
          ].join(", "),
          boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.4), inset 0 0 0 1px oklch(1 0 0 / 0.14)",
        }}
      >
        {/* brilho metálico */}
        <span
          className="absolute inset-0"
          style={{
            backgroundImage: "linear-gradient(115deg, transparent 22%, oklch(1 0.03 90 / 0.55) 42%, oklch(0.95 0.08 85 / 0.35) 52%, transparent 70%)",
            backgroundSize: "260% 100%",
            backgroundPosition: `${glare}% 0`,
            mixBlendMode: "soft-light",
            transition: "background-position 700ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </span>

      <span className="relative flex items-center justify-between gap-3 px-4 pt-4">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold" style={{ background: "oklch(0 0 0 / 0.16)", boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.2)" }}>
            {initials(c.pro.name)}
          </span>
          <span className="truncate text-[13px] font-bold tracking-tight">{c.pro.name}</span>
        </span>
        <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums">#{c.rank}</span>
      </span>
      <span className="absolute bottom-3.5 left-4 font-mono text-[15px] font-semibold tabular-nums">{brl(c.pro.faturamento)}</span>
      <span className="absolute bottom-3.5 right-4 opacity-70" aria-hidden>
        <Scissors size={18} strokeWidth={1.9} />
      </span>
    </>
  );
}

function TeamTile({ pros, reduced, onNavigate }: { pros: BarberPro[]; reduced: boolean; onNavigate?: (p: string) => void }) {
  const ranked = React.useMemo(() => [...pros].sort((a, b) => b.faturamento - a.faturamento).slice(0, 4), [pros]);
  // trás → frente: o líder fica na frente
  const cards: ProCard[] = React.useMemo(
    () => ranked.map((pro, i) => ({ pro, rank: i + 1, ...CARD_SKINS[i % CARD_SKINS.length] })).reverse(),
    [ranked]
  );
  const [order, setOrder] = React.useState(() => cards.map((c) => String(c.pro.id)));
  React.useEffect(() => setOrder(cards.map((c) => String(c.pro.id))), [cards]);
  const mounted = useMounted();
  const dragGlare = React.useRef(false);
  const [glare, setGlare] = React.useState(30);
  React.useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      setGlare((g) => (dragGlare.current ? g : 30 + Math.sin((now - t0) / 2600) * 30));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const title = (
    <span>
      Equipe <sup className="font-mono text-[10px]">{pros.length}</sup>
    </span>
  );
  if (!cards.length || order.length !== cards.length) {
    return (
      <Tile title={title} className="@4xl:col-start-3 @4xl:row-start-1">
        <Empty>Nenhum profissional com lançamentos neste mês.</Empty>
      </Tile>
    );
  }

  const PEEK = 40;
  const depth = order.length - 1;
  const front = cards.find((c) => String(c.pro.id) === order[order.length - 1]) ?? cards[cards.length - 1];

  return (
    <Tile
      title={title}
      action={
        onNavigate && (
          <button type="button" onClick={() => onNavigate("profissionais")} className="text-[11px] font-medium text-primary hover:underline">
            ver ranking →
          </button>
        )
      }
      className="@4xl:col-start-3 @4xl:row-start-1"
    >
      <div
        className="relative -mx-5 -mb-5 flex flex-1 flex-col justify-end overflow-hidden pt-1"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          dragGlare.current = true;
          setGlare(((e.clientX - r.left) / r.width) * 100);
        }}
        onPointerLeave={() => {
          dragGlare.current = false;
        }}
      >
        <div className="relative">
          {order.map((id, pos) => {
            const c = cards.find((x) => String(x.pro.id) === id);
            if (!c) return null;
            const fromFront = order.length - 1 - pos;
            const isFront = fromFront === 0;
            return (
              <button
                key={id}
                type="button"
                onClick={() => !isFront && setOrder((o) => [...o.filter((x) => x !== id), id])}
                aria-label={`${c.pro.name}, ${c.rank}º lugar${isFront ? ", selecionado" : ", trazer para frente"}`}
                aria-pressed={isFront}
                className="group absolute left-1/2 block w-[calc(100%-32px)] max-w-[300px] rounded-[12px] p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{
                  top: (depth - fromFront) * PEEK,
                  zIndex: pos + 1,
                  transform: `translateX(-50%) scale(${1 - fromFront * 0.055}) translateY(${mounted ? 0 : 20}px)`,
                  transformOrigin: "top center",
                  opacity: mounted ? 1 : 0,
                  color: c.ink,
                  boxShadow: "0 -10px 28px -14px oklch(0 0 0 / 0.85)",
                  transition: reduced
                    ? "none"
                    : `top 650ms cubic-bezier(0.34, 1.35, 0.64, 1), transform 650ms cubic-bezier(0.34, 1.35, 0.64, 1), opacity 500ms ease ${pos * 90}ms`,
                  cursor: isFront ? "default" : "pointer",
                }}
              >
                <span className="relative block w-full" style={{ paddingTop: "63.08%" }}>
                  <span className="absolute inset-0 block">
                    <CardFace c={c} glare={glare + fromFront * 18} />
                  </span>
                </span>
              </button>
            );
          })}
          <div aria-hidden className="invisible mx-auto w-[calc(100%-32px)] max-w-[300px] shrink-0" style={{ marginTop: depth * PEEK }}>
            <div style={{ paddingTop: "30%" }} />
          </div>
        </div>

        <div
          className="relative z-10 flex shrink-0 items-end justify-between gap-3 px-5 pb-4"
          style={{
            height: 84,
            background: "color-mix(in oklch, var(--color-card) 72%, transparent)",
            backdropFilter: "blur(18px) saturate(1.3)",
            WebkitBackdropFilter: "blur(18px) saturate(1.3)",
            borderTop: "1px solid color-mix(in oklch, var(--color-foreground) 10%, transparent)",
          }}
          aria-live="polite"
        >
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">
              {front.rank}º · {front.pro.name}
            </p>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {front.pro.clientes} atendimentos · ticket {brl(front.pro.ticket)}
            </p>
          </div>
          <p className="shrink-0 font-mono text-[15px] font-semibold tabular-nums">{brlShort(front.pro.faturamento)}</p>
        </div>
      </div>
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Velocímetro da meta                                                */
/* ------------------------------------------------------------------ */

type MetaTab = "Mês" | "1ª Q" | "2ª Q";

function GaugeTile({ p, accent }: { p: BarberBentoProps; accent: string }) {
  const [tab, setTab] = React.useState<MetaTab>("Mês");
  const period = tab === "Mês" ? p.mensal : p.quinzenas[tab === "1ª Q" ? 0 : 1];
  const t = Math.min(1, (period.percentual || 0) / 100);
  const R = 62;
  const len = Math.PI * R;
  const angle = -90 + t * 180;
  const done = period.meta > 0 && period.realizado >= period.meta;

  return (
    <Tile
      title={tab === "Mês" ? "Meta mensal" : "Meta quinzenal · SVA + assin."}
      className="@4xl:col-start-4 @4xl:row-start-1"
      action={done ? <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">batida</span> : undefined}
    >
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="relative" style={{ width: 150, height: 86 }}>
          <svg width="150" height="86" viewBox="0 0 150 86" aria-hidden>
            <path d="M 13 78 A 62 62 0 0 1 137 78" fill="none" strokeWidth="10" strokeLinecap="round" style={{ stroke: "var(--color-muted)" }} />
            <path
              d="M 13 78 A 62 62 0 0 1 137 78"
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={len}
              style={{ stroke: accent, strokeDashoffset: len * (1 - t), transition: `stroke-dashoffset 900ms ${EASE}` }}
            />
            <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "75px 78px", transition: `transform 900ms ${EASE}` }}>
              <line x1="75" y1="78" x2="75" y2="30" strokeWidth="2.5" strokeLinecap="round" style={{ stroke: "var(--color-foreground)" }} />
            </g>
            <circle cx="75" cy="78" r="5" style={{ fill: "var(--color-foreground)" }} />
          </svg>
        </div>
        <p className="mt-2 font-mono text-[26px] font-semibold leading-none tabular-nums">{pct(period.percentual)}</p>
        <p className="mt-1 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
          {brlShort(period.realizado)} de {brlShort(period.meta)}
        </p>
        <p className="mt-0.5 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
          {done ? "meta alcançada" : `faltam ${brlShort(period.restante)}`}
        </p>
      </div>
      <div className="mt-4 flex justify-center">
        <Pills label="Período da meta" value={tab} options={["Mês", "1ª Q", "2ª Q"]} onChange={setTab} />
      </div>
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Acumulado vs ritmo da meta                                         */
/* ------------------------------------------------------------------ */

function ChartTile({ p, accent, reduced }: { p: BarberBentoProps; accent: string; reduced: boolean }) {
  const uid = React.useId().replace(/:/g, "");
  const [tab, setTab] = React.useState<MetaTab>("Mês");
  const [hover, setHover] = React.useState<number | null>(null);
  const mounted = useMounted();

  const isMonth = tab === "Mês";
  const period = isMonth ? p.mensal : p.quinzenas[tab === "1ª Q" ? 0 : 1];
  const days = p.dias.filter((d) => d.dia >= period.inicio && d.dia <= period.termino);
  const val = (d: BarberDay) => (isMonth ? d.total : d.sva + d.novas_assinaturas);
  const uteis = days.filter((d) => d.util).length || 1;
  let acc = 0;
  let u = 0;
  const real: number[] = [];
  const pace: number[] = [];
  days.forEach((d) => {
    acc += val(d);
    if (d.util) u++;
    real.push(acc);
    pace.push(period.meta * (u / uteis));
  });
  const lastReal = Math.max(0, Math.min(days.length, p.diaApuracao - period.inicio + 1));
  const a = [0, ...real.slice(0, lastReal)];
  const b = [0, ...pace];
  const n = b.length;
  const W = 640;
  const H = 220;
  const hi = Math.max(...a, ...b, 1);
  const x = (i: number) => (i / Math.max(1, n - 1)) * W;
  const y = (v: number) => H - 16 - (v / hi) * (H - 40);
  const pa = a.map((v, i) => [x(i), y(v)] as const);
  const pb = b.map((v, i) => [x(i), y(v)] as const);
  const la = smooth(pa);
  const lb = smooth(pb);
  const idx = Math.min(hover ?? a.length - 1, n - 1);
  const ai = Math.min(idx, a.length - 1);
  const refPace = b[a.length - 1] || 0;
  const lead = refPace ? ((a[a.length - 1] - refPace) / refPace) * 100 : 0;
  const labelDays = days
    .filter((d, i) => i % Math.ceil(days.length / 6) === 0 && period.termino - d.dia >= 3)
    .map((d) => String(d.dia).padStart(2, "0"));

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
  };
  const left = `${(pb[idx][0] / W) * 100}%`;
  const dayLabel = idx === 0 ? "início" : `dia ${days[idx - 1]?.dia ?? ""}`;

  return (
    <Tile
      title={isMonth ? "Faturamento acumulado vs ritmo da meta" : "SVA + assinaturas acumulado vs meta da quinzena"}
      className="@xl:col-span-2 @4xl:col-span-2 @4xl:col-start-1 @4xl:row-span-2 @4xl:row-start-2"
      action={<Pills label="Período do gráfico" value={tab} options={["Mês", "1ª Q", "2ª Q"]} onChange={setTab} />}
    >
      <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
        <div>
          <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="h-[3px] w-4 rounded-full" style={{ background: accent }} aria-hidden />
            Realizado {hover !== null && `· ${dayLabel}`}
          </p>
          <p className="mt-1 font-mono text-[22px] font-semibold tabular-nums">{hover !== null && idx >= a.length ? "—" : brl(a[ai])}</p>
        </div>
        <div>
          <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="h-0 w-4 border-t-2 border-dashed border-muted-foreground" aria-hidden />
            Ritmo ideal da meta
          </p>
          <p className="mt-1 font-mono text-[22px] font-semibold tabular-nums text-muted-foreground">{brl(b[idx])}</p>
        </div>
        <span
          className="ml-auto rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold tabular-nums"
          style={{ background: `color-mix(in oklch, ${accent} 18%, transparent)`, color: accent }}
        >
          {lead >= 0 ? "+" : "−"}
          {pct(Math.abs(lead))} vs ritmo
        </span>
      </div>

      <div
        className="relative mt-4 flex-1 touch-pan-y"
        style={{ minHeight: 220 }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Realizado ${brl(a[a.length - 1])} contra ritmo ideal ${brl(refPace)} e meta ${brl(period.meta)}`}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <linearGradient id={`${uid}-f`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" style={{ stopColor: accent, stopOpacity: 0.3 }} />
              <stop offset="1" style={{ stopColor: accent, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} vectorEffect="non-scaling-stroke" strokeDasharray="1 5" style={{ stroke: "var(--color-border)" }} />
          ))}
          {a.length > 1 && (
            <path
              d={`${la} L ${pa[pa.length - 1][0]} ${H} L 0 ${H} Z`}
              fill={`url(#${uid}-f)`}
              style={{ opacity: mounted ? 1 : 0, transition: "opacity 900ms ease 400ms" }}
            />
          )}
          <path d={lb} fill="none" strokeWidth={1.5} strokeDasharray="4 5" vectorEffect="non-scaling-stroke" style={{ stroke: "var(--color-muted-foreground)" }} />
          {a.length > 1 && (
            <path
              key={tab}
              d={la}
              fill="none"
              strokeWidth={2.5}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pathLength={1}
              style={{ stroke: accent, strokeDasharray: 1, strokeDashoffset: mounted || reduced ? 0 : 1, transition: reduced ? "none" : `stroke-dashoffset 1300ms ${EASE}` }}
            />
          )}
        </svg>
        <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-border" style={{ left, opacity: hover !== null ? 1 : 0 }} />
        {idx < a.length && (
          <span
            aria-hidden
            className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-card"
            style={{ left: `${(pa[ai][0] / W) * 100}%`, top: `${(pa[ai][1] / H) * 100}%`, background: accent }}
          />
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-muted-foreground"
          style={{ left, top: `${(pb[idx][1] / H) * 100}%`, opacity: hover !== null ? 1 : 0 }}
        />
      </div>
      <div className="mt-3 flex justify-between font-mono text-[11px] text-muted-foreground" aria-hidden>
        {labelDays.map((l) => (
          <span key={l}>{l}</span>
        ))}
        <span>{String(period.termino).padStart(2, "0")}</span>
      </div>
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Composição do faturamento                                          */
/* ------------------------------------------------------------------ */

function CompositionTile({ items, accent, accent2 }: { items: { label: string; value: number }[]; accent: string; accent2: string }) {
  const mounted = useMounted();
  const total = items.reduce((s, a) => s + a.value, 0);
  const colors = [accent, accent2, "oklch(0.92 0.04 90)", "oklch(0.62 0.02 80)", "oklch(0.42 0.015 80)"];
  const [hover, setHover] = React.useState<number | null>(null);

  return (
    <Tile title="Composição do faturamento" className="@4xl:col-start-3 @4xl:row-start-2">
      <p className="font-mono text-[22px] font-semibold tabular-nums">{brl(total)}</p>
      {total > 0 ? (
        <>
          <div className="mt-4 flex h-9 gap-1" onPointerLeave={() => setHover(null)}>
            {items.map((a, i) =>
              a.value > 0 ? (
                <span
                  key={a.label}
                  onPointerEnter={() => setHover(i)}
                  className="min-w-[4px] rounded-[8px]"
                  title={`${a.label}: ${brl2(a.value)}`}
                  style={{
                    flexBasis: mounted ? `${(a.value / total) * 100}%` : `${100 / items.length}%`,
                    background: colors[i % colors.length],
                    opacity: hover === null || hover === i ? 1 : 0.3,
                    transition: `flex-basis 1000ms ${EASE} ${200 + i * 60}ms, opacity 200ms ease`,
                  }}
                />
              ) : null
            )}
          </div>
          <ul className="mt-4 grid grid-cols-1 gap-y-2">
            {items.map((a, i) => (
              <li
                key={a.label}
                className="flex items-center justify-between gap-2 text-[12px]"
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              >
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: colors[i % colors.length] }} aria-hidden />
                  {a.label}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {brlShort(a.value)} · {pct((a.value / total) * 100)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <Empty>Sem faturamento lançado neste mês.</Empty>
      )}
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Quinzena: bloco dourado                                            */
/* ------------------------------------------------------------------ */

function QuinzenaTile({ p, accent, onNavigate }: { p: BarberBentoProps; accent: string; onNavigate?: (path: string) => void }) {
  const q = p.quinzenas[p.quinzenaAtual - 1];
  const totalDias = q.termino - q.inicio + 1;
  const decorridos = Math.max(0, Math.min(totalDias, p.diaApuracao - q.inicio + 1));
  const last10 = p.dias.filter((d) => d.dia >= q.inicio && d.dia <= Math.min(q.termino, p.diaApuracao)).slice(-10);
  const max = Math.max(...last10.map((d) => d.sva + d.novas_assinaturas), 1);
  const done = q.meta > 0 && q.realizado >= q.meta;
  const tint = (a: number) => `oklch(0.18 0.02 75 / ${a})`;

  return (
    <section
      className="relative flex min-w-0 flex-col overflow-hidden rounded-[26px] p-5 @4xl:col-start-4 @4xl:row-span-2 @4xl:row-start-2"
      style={{ background: `linear-gradient(160deg, oklch(0.9 0.11 90) 0%, ${accent} 45%, oklch(0.66 0.13 68) 100%)`, color: INK }}
    >
      <header className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold opacity-75">{p.quinzenaAtual}ª quinzena · SVA + assinaturas</h3>
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold" style={{ background: tint(0.12) }}>
          <span className="size-1.5 rounded-full" style={{ background: INK }} aria-hidden />
          {done ? "Batida" : "Em curso"}
        </span>
      </header>

      <p className="mt-5 font-mono text-[52px] font-semibold leading-none tracking-[-0.05em] tabular-nums">
        {NUM1.format(q.percentual || 0)}
        <span className="text-[22px]">%</span>
      </p>
      <p className="mt-1 text-[12px] font-medium opacity-70">da meta de {brl(q.meta)}</p>

      <div className="mt-5 rounded-2xl p-3" style={{ background: tint(0.1) }}>
        <div className="flex items-baseline justify-between text-[12px] font-semibold">
          <span className="opacity-70">Até o dia {q.termino}</span>
          <span className="whitespace-nowrap font-mono tabular-nums">{q.dias_uteis_restantes} dias úteis</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: tint(0.14) }}>
          <div className="h-full rounded-full" style={{ width: `${(decorridos / totalDias) * 100}%`, background: INK, transition: `width 1s ${EASE}` }} />
        </div>
      </div>
      <dl className="mt-3 space-y-1.5 text-[12px]">
        {[
          ["Realizado", brl(q.realizado)],
          ["Faltam", brl(q.restante)],
          ["Restante por dia", brl(q.restante_por_dia)],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="opacity-70">{k}</dt>
            <dd className="font-mono font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto pt-6">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[12px] font-semibold opacity-70">SVA</p>
            <p className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums">{brlShort(q.sva ?? 0)}</p>
          </div>
          <div>
            <p className="text-[12px] font-semibold opacity-70">Assinaturas</p>
            <p className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums">{brlShort(q.assinaturas ?? 0)}</p>
          </div>
        </div>

        <div className="mt-5 flex h-12 items-end gap-1" aria-hidden>
          {last10.length ? (
            last10.map((d, i) => (
              <span
                key={d.date}
                className="flex-1 rounded-[4px]"
                style={{ height: `${Math.max(6, ((d.sva + d.novas_assinaturas) / max) * 100)}%`, background: INK, opacity: 0.14 + (i / last10.length) * 0.55 }}
              />
            ))
          ) : (
            <span className="flex-1 self-center text-center text-[11px] opacity-60">quinzena ainda não começou</span>
          )}
        </div>
        <p className="mt-1.5 font-mono text-[10px] opacity-60">Últimos {last10.length || 10} dias</p>

        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate("faturamento")}
            className="mt-4 w-full rounded-2xl py-3 text-sm font-semibold transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{ background: INK, color: accent }}
          >
            Ver faturamento diário
          </button>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Ticket médio: faixa entre profissionais                            */
/* ------------------------------------------------------------------ */

function TicketTile({ pros, accent }: { pros: BarberPro[]; accent: string }) {
  const list = pros.filter((p) => p.ticket > 0);
  // Ticket da equipe na mesma base dos individuais: faturamento ÷ atendimentos que geraram pagamento
  const pagos = list.reduce((s, p) => s + p.faturamento / p.ticket, 0);
  const team = pagos ? list.reduce((s, p) => s + p.faturamento, 0) / pagos : 0;
  if (list.length < 1) {
    return (
      <Tile title="Ticket médio da equipe" className="@4xl:col-start-3 @4xl:row-start-3">
        <Empty>Sem dados de ticket neste mês.</Empty>
      </Tile>
    );
  }
  const min = Math.min(...list.map((p) => p.ticket));
  const max = Math.max(...list.map((p) => p.ticket));
  const spread = Math.max(max - min, max * 0.2, 1);
  const lo = Math.max(0, min - spread * 0.35);
  const hi = max + spread * 0.35;
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const best = list.reduce((a, b) => (b.ticket > a.ticket ? b : a));

  return (
    <Tile
      title="Ticket médio da equipe"
      className="@4xl:col-start-3 @4xl:row-start-3"
      action={
        <span className="rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold" style={{ background: `color-mix(in oklch, ${accent} 18%, transparent)`, color: accent }}>
          {list.length} prof.
        </span>
      }
    >
      <p className="font-mono text-[22px] font-semibold tabular-nums">{brl2(team)}</p>
      <p className="font-mono text-[11px] text-muted-foreground">média ponderada dos profissionais</p>

      <div className="relative mt-6 h-10" role="img" aria-label={`Tickets entre ${brl(min)} e ${brl(max)}; equipe ${brl(team)}`}>
        <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-muted" />
        <div
          className="absolute top-1/2 h-10 -translate-y-1/2 rounded-[10px]"
          style={{
            left: `${pos(min)}%`,
            width: `${Math.max(2, pos(max) - pos(min))}%`,
            background: `repeating-linear-gradient(135deg, color-mix(in oklch, ${accent} 26%, transparent) 0 6px, color-mix(in oklch, ${accent} 12%, transparent) 6px 12px)`,
            boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${accent} 55%, transparent)`,
          }}
        />
        {list.map((p) => (
          <span
            key={p.id}
            title={`${p.name}: ${brl2(p.ticket)}`}
            className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground"
            style={{ left: `${pos(p.ticket)}%` }}
          />
        ))}
        <div
          className="absolute top-1/2 h-14 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
          style={{ left: `${Math.max(2, Math.min(98, pos(team)))}%`, transition: `left 900ms ${EASE}` }}
        />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] tabular-nums text-muted-foreground">
        <span>mín. {brl(min)}</span>
        <span>máx. {brl(max)}</span>
      </div>
      <p className="mt-auto pt-4 text-[12px] text-muted-foreground">
        Maior ticket <span className="font-semibold text-foreground">{best.name}</span>{" "}
        <span className="font-mono font-semibold tabular-nums text-foreground">{brl2(best.ticket)}</span>
      </p>
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  SVA dia a dia                                                      */
/* ------------------------------------------------------------------ */

function SvaStreamTile({ p, accent, reduced }: { p: BarberBentoProps; accent: string; reduced: boolean }) {
  const days = p.dias.filter((d) => d.dia <= Math.max(p.diaApuracao, 0));
  const vals = days.map((d) => d.sva + d.novas_assinaturas);
  const max = Math.max(...vals, 1);
  const withVal = vals.filter((v) => v > 0);
  const media = withVal.length ? withVal.reduce((s, v) => s + v, 0) / withVal.length : 0;
  const peakIdx = withVal.length ? vals.indexOf(Math.max(...vals)) : -1;
  const q = p.quinzenas[p.quinzenaAtual - 1];
  const lastIdx = days.length - 1;

  return (
    <Tile
      title="SVA + assinaturas por dia"
      className="@xl:col-span-2 @4xl:col-span-2 @4xl:col-start-1 @4xl:row-start-4"
      action={<span className="font-mono text-[11px] text-muted-foreground">até dia {p.diaApuracao || "—"}</span>}
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[22px] font-semibold tabular-nums">{brl(vals.reduce((s, v) => s + v, 0))}</p>
          <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
            no mês · {withVal.length} dias com venda
          </p>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">meta/dia {brlShort(q.restante_por_dia)}</p>
      </div>
      <div className="mt-4 flex flex-1 items-end gap-[3px]" style={{ minHeight: 64 }}>
        {days.length ? (
          days.map((d, i) => {
            const isLast = i === lastIdx;
            return (
              <span
                key={d.date}
                title={`${ddmm(d.date)}: ${brl2(vals[i])}`}
                className="flex-1 rounded-[3px]"
                style={{
                  height: `${Math.max(4, (vals[i] / max) * 100)}%`,
                  background: isLast || i === peakIdx ? accent : "var(--color-muted-foreground)",
                  opacity: isLast || i === peakIdx ? 1 : 0.15 + (i / days.length) * 0.45,
                  animation: isLast && !reduced ? "bento-pop 500ms cubic-bezier(.3,1.5,.6,1)" : undefined,
                  transformOrigin: "bottom",
                }}
              />
            );
          })
        ) : (
          <Empty>Mês ainda não iniciado.</Empty>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3">
        {[
          ["Média por dia", brlShort(media)],
          ["Pico", peakIdx >= 0 && vals[peakIdx] ? `${brlShort(vals[peakIdx])} · ${ddmm(days[peakIdx].date)}` : "—"],
          ["Projeção do mês", brlShort(p.mensal.projecao)],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="mt-0.5 truncate font-mono text-[13px] font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Atividade recente (webhook)                                        */
/* ------------------------------------------------------------------ */

const KIND_ICON: Record<BarberActivity["kind"], React.ElementType> = {
  venda: Scissors,
  assinatura: Crown,
  cancelamento: Undo2,
  fechamento: CalendarCheck,
  mensal: Users,
  outro: Activity,
};

function ActivityTile({ items, accent, accent2, onNavigate }: { items: BarberActivity[]; accent: string; accent2: string; onNavigate?: (p: string) => void }) {
  const mounted = useMounted();
  return (
    <Tile
      title="Atividade recente · CashBarber"
      className="@xl:col-span-2 @4xl:col-span-2 @4xl:col-start-3 @4xl:row-start-4"
      action={
        onNavigate && (
          <button type="button" onClick={() => onNavigate("admin/integracao")} className="text-[11px] font-medium text-primary hover:underline">
            integração →
          </button>
        )
      }
    >
      {items.length ? (
        <ul className="-mx-2 -my-1">
          {items.slice(0, 4).map((a, i) => {
            const Icon = KIND_ICON[a.kind] ?? Activity;
            return (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-muted/50"
                style={{ opacity: mounted ? 1 : 0, transform: mounted ? "none" : "translateY(6px)", transition: `opacity 500ms ease ${300 + i * 70}ms, transform 500ms ${EASE} ${300 + i * 70}ms` }}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-primary">
                  <Icon size={16} strokeWidth={1.9} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{a.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {a.detail} · {a.time}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[13px] font-medium tabular-nums">{a.amount}</p>
                  <p
                    className="mt-0.5 font-mono text-[10px] font-semibold"
                    style={{ color: a.status === "duplicado" ? accent : a.status === "erro" ? accent2 : "var(--color-muted-foreground)" }}
                  >
                    {a.status}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>
          Nenhuma venda recebida ainda.
          <br />
          Assim que o CashBarber enviar eventos ao webhook, eles aparecem aqui.
        </Empty>
      )}
    </Tile>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard                                                          */
/* ------------------------------------------------------------------ */

export function BarberBento(props: BarberBentoProps) {
  const { accent = "oklch(0.8 0.13 85)", accent2 = "oklch(0.58 0.09 60)", className, onNavigate } = props;
  const reduced = useReducedMotion();

  return (
    <div className={cn("bento-root @container w-full", className)}>
      <style>{`@keyframes bento-pop { 0% { transform: scaleY(0) } 100% { transform: scaleY(1) } }`}</style>

      <nav className="mb-3 flex flex-wrap items-center justify-end gap-2 px-1" aria-label="Resumo">
        <span className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[12px] font-medium">
          <span className="size-2 rounded-full" style={{ background: accent }} aria-hidden />
          {props.unidade}
        </span>
        {props.assinaturas && (
          <span className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[12px] font-medium">
            <Crown size={13} strokeWidth={2} style={{ color: accent }} aria-hidden />
            {props.assinaturas.total.toLocaleString("pt-BR")} assinaturas
          </span>
        )}
        <span className="rounded-full bg-primary px-3 py-1.5 font-mono text-[12px] font-semibold text-primary-foreground">
          {props.mesNome} {props.ano} · dia {props.diaApuracao || "—"}
        </span>
      </nav>

      <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-4">
        <HeroTile p={props} accent={accent} accent2={accent2} reduced={reduced} />
        <TeamTile pros={props.profissionais} reduced={reduced} onNavigate={onNavigate} />
        <GaugeTile p={props} accent={accent} />
        <ChartTile p={props} accent={accent} reduced={reduced} />
        <CompositionTile items={props.composicao} accent={accent} accent2={accent2} />
        <QuinzenaTile p={props} accent={accent} onNavigate={onNavigate} />
        <TicketTile pros={props.profissionais} accent={accent} />
        <SvaStreamTile p={props} accent={accent} reduced={reduced} />
        <ActivityTile items={props.atividade} accent={accent} accent2={accent2} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

export default BarberBento;
