// R2: Web-only geometry editor (mouse + keyboard). Rendered EXCLUSIVELY on
// Platform.OS === "web" for the admin role — the mobile app never imports its UI path.
// Shapes are plain absolutely-positioned Views (no SVG/Skia — R2 ban).
// Geometry is NEVER used to compute areas/lengths/values (perspective drawings).
import React, { useState, useRef, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, Modal, Platform, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, font, radius, elementStatusColor } from "@/src/theme/tokens";
import { useI18n } from "@/src/i18n/I18nContext";
import { api, fileUrl } from "@/src/api/client";
import { Button } from "@/src/components/Button";
import { SelectField, SelectSheet } from "@/src/components/SelectSheet";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { useToast } from "@/src/components/Toast";

type Geom = { x: number; y: number; w: number; h: number; punkt: boolean };
type HistOp =
  | { t: "create"; els: any[] }
  | { t: "geom"; before: any[]; after: any[] }
  | { t: "archive"; items: { id: string; status: string }[] };

const BASE_W = 1200;

function toGeom(el: any): Geom {
  if (el.geometria_typ === "prostokat" && el.geometria_json?.punkty?.length === 4) {
    const xs = el.geometria_json.punkty.map((p: any) => p.x);
    const ys = el.geometria_json.punkty.map((p: any) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, punkt: false };
  }
  return { x: el.pozycja_x, y: el.pozycja_y, w: 0, h: 0, punkt: true };
}

function geomPayload(g: Geom) {
  if (g.punkt) {
    return { geometria_typ: "punkt", geometria_json: { punkty: [{ x: g.x, y: g.y }] }, pozycja_x: g.x, pozycja_y: g.y };
  }
  const pts = [
    { x: g.x, y: g.y }, { x: g.x + g.w, y: g.y },
    { x: g.x + g.w, y: g.y + g.h }, { x: g.x, y: g.y + g.h },
  ];
  return { geometria_typ: "prostokat", geometria_json: { punkty: pts }, pozycja_x: g.x + g.w / 2, pozycja_y: g.y + g.h / 2 };
}

function geomSnapshot(el: any) {
  return { id: el.id, geometria_typ: el.geometria_typ, geometria_json: el.geometria_json, pozycja_x: el.pozycja_x, pozycja_y: el.pozycja_y };
}

export function GeometryEditor({ view, elements, types, reload }: { view: any; elements: any[]; types: any[]; reload: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { width: winW } = useWindowDimensions();
  // BLOK 2: compact toolbar (icon-only) below 1500px — icon set fits fully even at
  // 820px (tablet portrait); horizontal scroll stays as a safety net
  const compact = winW < 1500;
  const aspect = view.szerokosc && view.wysokosc ? view.wysokosc / view.szerokosc : 0.75;
  const W = BASE_W, H = BASE_W * aspect;

  const [els, setEls] = useState<any[]>(elements);
  useEffect(() => { setEls(elements); }, [elements]);

  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [tool, setTool] = useState<"select" | "punkt" | "prostokat">("select");
  const [tr, setTr] = useState({ s: 0.5, tx: 20, ty: 20 });
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number } | null>(null);
  const [resizePrev, setResizePrev] = useState<{ id: string; g: Geom } | null>(null);
  const [snapOn, setSnapOn] = useState(false);
  const [snapStep, setSnapStep] = useState("2");
  const [form, setForm] = useState<{ geom: Geom; el?: any } | null>(null);
  const [kod, setKod] = useState(""); const [typId, setTypId] = useState<string | null>(null);
  const [opis, setOpis] = useState(""); const [typePicker, setTypePicker] = useState(false);
  const [dup, setDup] = useState<null | { mode: "grid" | "line" }>(null);
  const [cols, setCols] = useState("5"); const [rows, setRows] = useState("4");
  const [gapX, setGapX] = useState("2"); const [gapY, setGapY] = useState("3");
  const [count, setCount] = useState("5"); const [dir, setDir] = useState<"h" | "v">("h");
  const [prefix, setPrefix] = useState("O-"); const [startNum, setStartNum] = useState("1");
  const [collisions, setCollisions] = useState<string[]>([]);
  const [delOpen, setDelOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  const stageRef = useRef<any>(null);
  const stageSize = useRef({ w: 800, h: 600 });
  const stagePos = useRef({ px: 0, py: 0 });
  const pinch = useRef<null | { d0: number; s0: number; mid: { x: number; y: number }; tx0: number; ty0: number }>(null);
  const hist = useRef<{ past: HistOp[]; future: HistOp[] }>({ past: [], future: [] });
  const drag = useRef<null | { x: number; y: number; orig: Map<string, Geom> }>(null);
  const resize = useRef<null | { id: string; corner: number; orig: Geom }>(null);
  const pan = useRef<null | { x: number; y: number; tx: number; ty: number }>(null);
  const space = useRef(false); const shift = useRef(false);
  const clip = useRef<Geom[]>([]);
  const trRef = useRef(tr); trRef.current = tr;
  const elsRef = useRef(els); elsRef.current = els;
  const selRef = useRef(sel); selRef.current = sel;
  const toolRef = useRef(tool); toolRef.current = tool;
  const drawRef = useRef(drawStart); drawRef.current = drawStart;
  const marqueeRef = useRef(marquee); marqueeRef.current = marquee;
  const modalOpenRef = useRef(false); modalOpenRef.current = !!form || !!dup || delOpen;

  const stepRel = useCallback(() => {
    const s = Math.max(0.1, parseFloat(snapStep.replace(",", ".")) || 2) / 100;
    return { sx: s, sy: s * (W / H) };
  }, [snapStep, W, H]);

  const snapV = useCallback((x: number, y: number) => {
    if (!snapOn) return { x, y };
    const { sx, sy } = stepRel();
    return { x: Math.round(x / sx) * sx, y: Math.round(y / sy) * sy };
  }, [snapOn, stepRel]);

  const toRel = useCallback((cx: number, cy: number) => {
    if (Platform.OS === "web") {
      const node = stageRef.current as HTMLElement | null;
      if (!node || !(node as any).getBoundingClientRect) return { x: 0, y: 0 };
      const r = (node as any).getBoundingClientRect();
      stageSize.current = { w: r.width, h: r.height };
      const { s, tx, ty } = trRef.current;
      return { x: (cx - r.left - tx) / (s * W), y: (cy - r.top - ty) / (s * H) };
    }
    // native (tablet): stage position measured via measureInWindow on layout
    const { px, py } = stagePos.current;
    const { s, tx, ty } = trRef.current;
    return { x: (cx - px - tx) / (s * W), y: (cy - py - ty) / (s * H) };
  }, [W, H]);

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  const hitShape = useCallback((p: { x: number; y: number }) => {
    const list = elsRef.current;
    const { s } = trRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const g = toGeom(list[i]);
      if (g.punkt) {
        const tol = Platform.OS === "web" ? 12 : 24; // ≥48dp touch target on tablets
        if (Math.abs(p.x - g.x) * W * s < tol && Math.abs(p.y - g.y) * H * s < tol) return list[i];
      } else if (p.x >= g.x && p.x <= g.x + g.w && p.y >= g.y && p.y <= g.y + g.h) return list[i];
    }
    return null;
  }, [W, H]);

  const hitHandle = useCallback((p: { x: number; y: number }) => {
    const ids = Object.keys(selRef.current).filter((k) => selRef.current[k]);
    if (ids.length !== 1) return null;
    const el = elsRef.current.find((e) => e.id === ids[0]);
    if (!el) return null;
    const g = toGeom(el);
    if (g.punkt) return null;
    const { s } = trRef.current;
    const corners = [
      { x: g.x, y: g.y }, { x: g.x + g.w, y: g.y },
      { x: g.x + g.w, y: g.y + g.h }, { x: g.x, y: g.y + g.h },
    ];
    for (let i = 0; i < 4; i++) {
      // screen-pixel tolerance — 10px mouse / 24px touch (≥48dp target)
      const tol = Platform.OS === "web" ? 10 : 24;
      if (Math.abs(p.x - corners[i].x) * W * s < tol && Math.abs(p.y - corners[i].y) * H * s < tol) {
        return { id: el.id, corner: i, orig: g };
      }
    }
    return null;
  }, [W, H]);

  // ---- commits ------------------------------------------------------------
  const pushHist = (op: HistOp) => {
    hist.current.past.push(op);
    if (hist.current.past.length > 30) hist.current.past.shift();
    hist.current.future = [];
  };

  const commitGeom = async (before: any[], after: any[]) => {
    try {
      await api("/elements/batch-geometry", { method: "PUT", body: { updates: after } });
      pushHist({ t: "geom", before, after });
      setEls((p) => p.map((e) => { const u = after.find((a) => a.id === e.id); return u ? { ...e, ...u } : e; }));
      toast.show(t("saved"));
    } catch (e: any) { toast.show(e.message || t("error_generic"), "error"); reload(); }
  };

  const applyGeomLocal = (items: any[]) => {
    setEls((p) => p.map((e) => { const u = items.find((a) => a.id === e.id); return u ? { ...e, ...u } : e; }));
  };

  const undo = async () => {
    const op = hist.current.past.pop();
    if (!op) return;
    try {
      if (op.t === "geom") { await api("/elements/batch-geometry", { method: "PUT", body: { updates: op.before } }); applyGeomLocal(op.before); }
      if (op.t === "create") { await api("/elements/batch-archive", { method: "POST", body: { ids: op.els.map((e) => e.id) } }); setEls((p) => p.filter((e) => !op.els.some((c) => c.id === e.id))); }
      if (op.t === "archive") { await api("/elements/batch-restore", { method: "POST", body: { items: op.items } }); reload(); }
      hist.current.future.push(op);
      toast.show(t("undone"));
    } catch (e: any) { toast.show(e.message || t("error_generic"), "error"); reload(); }
  };

  const redo = async () => {
    const op = hist.current.future.pop();
    if (!op) return;
    try {
      if (op.t === "geom") { await api("/elements/batch-geometry", { method: "PUT", body: { updates: op.after } }); applyGeomLocal(op.after); }
      if (op.t === "create") { await api("/elements/batch-restore", { method: "POST", body: { items: op.els.map((e) => ({ id: e.id, status: "do_wykonania" })) } }); reload(); }
      if (op.t === "archive") { await api("/elements/batch-archive", { method: "POST", body: { ids: op.items.map((i) => i.id) } }); setEls((p) => p.filter((e) => !op.items.some((c) => c.id === e.id))); }
      hist.current.past.push(op);
      toast.show(t("redone"));
    } catch (e: any) { toast.show(e.message || t("error_generic"), "error"); reload(); }
  };

  const selIds = Object.keys(sel).filter((k) => sel[k]);
  const selEls = els.filter((e) => sel[e.id]);

  const archiveSelected = async () => {
    setDelOpen(false);
    const items = selEls.map((e) => ({ id: e.id, status: e.status }));
    if (!items.length) return;
    try {
      await api("/elements/batch-archive", { method: "POST", body: { ids: items.map((i) => i.id) } });
      pushHist({ t: "archive", items });
      setEls((p) => p.filter((e) => !sel[e.id])); setSel({});
      toast.show(t("archived_n").replace("{n}", String(items.length)));
    } catch (e: any) { toast.show(e.message || t("error_generic"), "error"); }
  };

  // ---- alignment / arrangement (F4) --------------------------------------
  const arrange = async (kind: string) => {
    const items = selEls.map((e) => ({ el: e, g: toGeom(e) }));
    if (items.length < 1) return;
    const before = selEls.map(geomSnapshot);
    const gs = items.map((i) => ({ ...i.g }));
    const minX = Math.min(...gs.map((g) => g.x)), maxX = Math.max(...gs.map((g) => g.x + g.w));
    const minY = Math.min(...gs.map((g) => g.y)), maxY = Math.max(...gs.map((g) => g.y + g.h));
    if (kind === "left") gs.forEach((g) => { g.x = minX; });
    if (kind === "right") gs.forEach((g) => { g.x = maxX - g.w; });
    if (kind === "hcenter") gs.forEach((g) => { g.x = (minX + maxX) / 2 - g.w / 2; });
    if (kind === "top") gs.forEach((g) => { g.y = minY; });
    if (kind === "bottom") gs.forEach((g) => { g.y = maxY - g.h; });
    if (kind === "vcenter") gs.forEach((g) => { g.y = (minY + maxY) / 2 - g.h / 2; });
    if (kind === "disth" || kind === "distv") {
      const key = kind === "disth" ? "x" : "y"; const size = kind === "disth" ? "w" : "h";
      const order = gs.map((g, i) => i).sort((a, b) => (gs[a][key] + gs[a][size] / 2) - (gs[b][key] + gs[b][size] / 2));
      const first = gs[order[0]][key] + gs[order[0]][size] / 2;
      const last = gs[order[order.length - 1]][key] + gs[order[order.length - 1]][size] / 2;
      order.forEach((idx, i) => { const c = first + (last - first) * (i / (order.length - 1 || 1)); gs[idx][key] = c - gs[idx][size] / 2; });
    }
    if (kind === "same") { const f = toGeom(selEls[0]); gs.forEach((g) => { if (!g.punkt && !f.punkt) { const cx = g.x + g.w / 2, cy = g.y + g.h / 2; g.w = f.w; g.h = f.h; g.x = cx - f.w / 2; g.y = cy - f.h / 2; } }); }
    if (kind === "mirrorh") { const c = (minX + maxX) / 2; gs.forEach((g) => { g.x = 2 * c - g.x - g.w; }); }
    if (kind === "mirrorv") { const c = (minY + maxY) / 2; gs.forEach((g) => { g.y = 2 * c - g.y - g.h; }); }
    const after = items.map((it, i) => ({ id: it.el.id, ...geomPayload({ ...gs[i], x: clamp01(gs[i].x), y: clamp01(gs[i].y) }) }));
    await commitGeom(before, after);
  };

  // ---- duplication (F3, central feature) ----------------------------------
  const dupPreview = useCallback(() => {
    if (!dup || selEls.length !== 1) return { ghosts: [] as Geom[], codes: [] as string[] };
    const g0 = toGeom(selEls[0]);
    const gx = (parseFloat(gapX.replace(",", ".")) || 0) / 100;
    const gy = ((parseFloat(gapY.replace(",", ".")) || 0) / 100) * (W / H);
    const ghosts: Geom[] = []; const codes: string[] = [];
    const start = parseInt(startNum) || 1; const pad = startNum.length;
    let n = start;
    const push = (dx: number, dy: number) => {
      ghosts.push({ ...g0, x: g0.x + dx, y: g0.y + dy });
      codes.push(`${prefix}${String(n).padStart(pad, "0")}`); n += 1;
    };
    if (dup.mode === "grid") {
      const c = Math.max(1, parseInt(cols) || 1), r = Math.max(1, parseInt(rows) || 1);
      for (let ry = 0; ry < r; ry++) for (let cx = 0; cx < c; cx++) {
        if (cx === 0 && ry === 0) continue;
        push(cx * (g0.w + gx), ry * (g0.h + gy));
      }
    } else {
      const cnt = Math.max(1, parseInt(count) || 1);
      for (let i = 1; i <= cnt; i++) push(dir === "h" ? i * (g0.w + gx) : 0, dir === "v" ? i * (g0.h + gy) : 0);
    }
    return { ghosts, codes };
  }, [dup, selEls, gapX, gapY, cols, rows, count, dir, prefix, startNum, W, H]);

  const confirmDup = async () => {
    const { ghosts, codes } = dupPreview();
    if (!ghosts.length) return;
    try {
      // F3: validate the WHOLE series BEFORE creating anything (hard unique index).
      const v: any = await api(`/projects/${view.project_id}/elements/validate-codes`, { method: "POST", body: { kody: codes } });
      if (!v.ok) { setCollisions(v.taken); return; }
      const payload = ghosts.map((g, i) => ({ kod: codes[i], typ_id: selEls[0].typ_id, opis: "", ...geomPayload(g) }));
      const r: any = await api(`/views/${view.id}/elements/batch`, { method: "POST", body: { elementy: payload } });
      pushHist({ t: "create", els: r.created });
      setEls((p) => [...p, ...r.created]);
      setDup(null); setCollisions([]);
      toast.show(t("created_n").replace("{n}", String(r.created.length)));
    } catch (e: any) { toast.show(e.message || t("error_generic"), "error"); }
  };

  // ---- create / edit form --------------------------------------------------
  const openCreateForm = (geom: Geom) => { setKod(""); setTypId(null); setOpis(""); setForm({ geom }); };
  const saveForm = async () => {
    if (!form || !kod.trim()) return;
    try {
      if (form.el) {
        const r = await api(`/elements/${form.el.id}`, { method: "PUT", body: { kod: kod.trim(), typ_id: typId, opis } });
        setEls((p) => p.map((e) => (e.id === form.el.id ? { ...e, ...r } : e)));
      } else {
        const r: any = await api(`/views/${view.id}/elements`, { method: "POST", body: { kod: kod.trim(), opis, typ_id: typId, ...geomPayload(form.geom) } });
        pushHist({ t: "create", els: [r] });
        setEls((p) => [...p, r]);
      }
      setForm(null); toast.show(t("saved"));
    } catch (e: any) { toast.show(e?.status === 409 ? t("code_taken") : (e.message || t("error_generic")), "error"); }
  };

  const copySel = () => { clip.current = selEls.map((e) => toGeom(e)); if (clip.current.length) toast.show(t("copied")); };
  const pasteClip = () => {
    if (!clip.current.length) return;
    const g = clip.current[0];
    openCreateForm({ ...g, x: clamp01(g.x + 0.02), y: clamp01(g.y + 0.02) });
  };

  // ---- shared pointer core (mouse on web, touch on tablets) ----------------
  const pointerDown = (p0: { x: number; y: number }, ctrl: boolean) => {
    const p = snapV(clamp01(p0.x), clamp01(p0.y));
    if (toolRef.current === "punkt") { openCreateForm({ x: p.x, y: p.y, w: 0, h: 0, punkt: true }); return; }
    if (toolRef.current === "prostokat") {
      if (!drawRef.current) { setDrawStart(p); }
      else {
        const a = drawRef.current; let bx = p.x, by = p.y;
        if (shift.current) {
          const dxp = (bx - a.x) * W, dyp = (by - a.y) * H;
          const m = Math.max(Math.abs(dxp), Math.abs(dyp));
          bx = a.x + Math.sign(dxp || 1) * (m / W); by = a.y + Math.sign(dyp || 1) * (m / H);
        }
        const g = { x: Math.min(a.x, bx), y: Math.min(a.y, by), w: Math.abs(bx - a.x), h: Math.abs(by - a.y), punkt: false };
        setDrawStart(null);
        if (g.w > 0.002 && g.h > 0.002) openCreateForm(g);
      }
      return;
    }
    const h = hitHandle(p0);
    if (h) { resize.current = h; return; }
    const shp = hitShape(p0);
    if (shp) {
      let nextSel = { ...selRef.current };
      if (ctrl) nextSel[shp.id] = !nextSel[shp.id];
      else if (!nextSel[shp.id]) nextSel = { [shp.id]: true };
      setSel(nextSel);
      const orig = new Map<string, Geom>();
      elsRef.current.forEach((el) => { if (nextSel[el.id]) orig.set(el.id, toGeom(el)); });
      drag.current = { x: p0.x, y: p0.y, orig };
    } else {
      if (!ctrl) setSel({});
      setMarquee({ x0: p0.x, y0: p0.y, x1: p0.x, y1: p0.y });
    }
  };

  const pointerMove = (p: { x: number; y: number }) => {
    setMouse({ x: p.x, y: p.y });
    if (resize.current) {
      const r = resize.current; const o = r.orig;
      const sp = snapV(clamp01(p.x), clamp01(p.y));
      let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
      if (r.corner === 0) { x1 = sp.x; y1 = sp.y; } if (r.corner === 1) { x2 = sp.x; y1 = sp.y; }
      if (r.corner === 2) { x2 = sp.x; y2 = sp.y; } if (r.corner === 3) { x1 = sp.x; y2 = sp.y; }
      setResizePrev({ id: r.id, g: { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), punkt: false } });
      return;
    }
    if (drag.current) {
      let dx = p.x - drag.current.x, dy = p.y - drag.current.y;
      if (snapOn) { const { sx, sy } = stepRel(); dx = Math.round(dx / sx) * sx; dy = Math.round(dy / sy) * sy; }
      setDragDelta({ dx, dy });
      return;
    }
    if (marqueeRef.current) setMarquee((m) => (m ? { ...m, x1: p.x, y1: p.y } : m));
  };

  const pointerUp = () => {
    if (resize.current) {
      const r = resize.current; resize.current = null;
      setResizePrev((prev) => {
        if (prev && (prev.g.w > 0.002 && prev.g.h > 0.002)) {
          const el = elsRef.current.find((e) => e.id === r.id);
          if (el) commitGeom([geomSnapshot(el)], [{ id: r.id, ...geomPayload(prev.g) }]);
        }
        return null;
      });
      return;
    }
    if (drag.current) {
      const d = drag.current; drag.current = null;
      setDragDelta((delta) => {
        if (delta && (Math.abs(delta.dx) > 0.0005 || Math.abs(delta.dy) > 0.0005)) {
          const before: any[] = []; const after: any[] = [];
          d.orig.forEach((g, id) => {
            const el = elsRef.current.find((e) => e.id === id);
            if (!el) return;
            before.push(geomSnapshot(el));
            after.push({ id, ...geomPayload({ ...g, x: clamp01(g.x + delta.dx), y: clamp01(g.y + delta.dy) }) });
          });
          if (after.length) commitGeom(before, after);
        }
        return null;
      });
      return;
    }
    if (marqueeRef.current) {
      const m = marqueeRef.current; setMarquee(null);
      const x1 = Math.min(m.x0, m.x1), x2 = Math.max(m.x0, m.x1);
      const y1 = Math.min(m.y0, m.y1), y2 = Math.max(m.y0, m.y1);
      if (x2 - x1 > 0.003 || y2 - y1 > 0.003) {
        setSel((prev) => {
          const next = { ...prev };
          elsRef.current.forEach((el) => {
            const g = toGeom(el);
            const cx = g.punkt ? g.x : g.x + g.w / 2, cy = g.punkt ? g.y : g.y + g.h / 2;
            if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) next[el.id] = true;
          });
          return next;
        });
      }
    }
  };

  // Listeners are bound once — expose ALWAYS-FRESH callbacks through a ref so
  // keyboard/mouse handlers never act on stale state (fixed after E2E audit).
  const actions = useRef({ copySel, pasteClip, undo, redo, commitGeom, pointerDown, pointerMove, pointerUp });
  actions.current = { copySel, pasteClip, undo, redo, commitGeom, pointerDown, pointerMove, pointerUp };

  // ---- global mouse/keyboard listeners ------------------------------------
  useEffect(() => {
    if (Platform.OS !== "web") return; // DOM listeners exist only on web
    const node = stageRef.current as any;
    if (!node) return;

    const onDown = (e: MouseEvent) => {
      if (modalOpenRef.current) return;
      if (e.button === 1 || space.current) {
        pan.current = { x: e.clientX, y: e.clientY, tx: trRef.current.tx, ty: trRef.current.ty };
        e.preventDefault(); return;
      }
      if (e.button !== 0) return;
      // Prevent native <img> drag-and-drop / text selection from hijacking the
      // mouse stream (browser cancels mousemove/mouseup once dragstart fires).
      e.preventDefault();
      actions.current.pointerDown(toRel(e.clientX, e.clientY), e.ctrlKey || e.metaKey);
    };

    const onMove = (e: MouseEvent) => {
      if (pan.current) {
        setTr((tr0) => ({ ...tr0, tx: pan.current!.tx + (e.clientX - pan.current!.x), ty: pan.current!.ty + (e.clientY - pan.current!.y) }));
        return;
      }
      actions.current.pointerMove(toRel(e.clientX, e.clientY));
    };

    const onUp = () => {
      pan.current = null;
      actions.current.pointerUp();
    };

    const onWheel = (e: WheelEvent) => {
      if (modalOpenRef.current) return;
      e.preventDefault();
      const node2 = stageRef.current as any;
      const r = node2.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setTr((t0) => {
        const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const s = Math.max(0.1, Math.min(8, t0.s * k));
        const f = s / t0.s;
        return { s, tx: mx - f * (mx - t0.tx), ty: my - f * (my - t0.ty) };
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") shift.current = true;
      if (e.code === "Space" && !modalOpenRef.current) { space.current = true; e.preventDefault(); }
      if (modalOpenRef.current) { if (e.key === "Escape") { setForm(null); setDup(null); setDelOpen(false); setCollisions([]); } return; }
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "Escape") { setDrawStart(null); setMarquee(null); setSel({}); }
      if (e.key === "Delete" || e.key === "Backspace") { if (Object.values(selRef.current).some(Boolean)) setDelOpen(true); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) { actions.current.redo(); } else { actions.current.undo(); } }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); actions.current.redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") { actions.current.copySel(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") { actions.current.pasteClip(); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") shift.current = false;
      if (e.code === "Space") space.current = false;
    };

    node.addEventListener("mousedown", onDown);
    node.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      node.removeEventListener("mousedown", onDown);
      node.removeEventListener("wheel", onWheel);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fit = () => {
    const { w, h } = stageSize.current;
    const s = Math.min(w / W, h / H) * 0.95;
    setTr({ s, tx: (w - W * s) / 2, ty: (h - H * s) / 2 });
  };

  const zoomBy = (k: number) => setTr((t0) => {
    const s = Math.max(0.1, Math.min(8, t0.s * k)); const f = s / t0.s;
    const mx = stageSize.current.w / 2, my = stageSize.current.h / 2;
    return { s, tx: mx - f * (mx - t0.tx), ty: my - f * (my - t0.ty) };
  });

  // ---- native (tablet) touch layer: 1 finger = pointer core, 2 fingers = pinch/pan
  const onTouchStart = (e: any) => {
    if (modalOpenRef.current) return;
    const ts = e.nativeEvent.touches;
    if (ts.length >= 2) {
      drag.current = null; resize.current = null; setMarquee(null); setDragDelta(null); setResizePrev(null);
      const dx = ts[0].pageX - ts[1].pageX, dy = ts[0].pageY - ts[1].pageY;
      pinch.current = { d0: Math.hypot(dx, dy) || 1, s0: trRef.current.s, mid: { x: (ts[0].pageX + ts[1].pageX) / 2, y: (ts[0].pageY + ts[1].pageY) / 2 }, tx0: trRef.current.tx, ty0: trRef.current.ty };
      return;
    }
    actions.current.pointerDown(toRel(ts[0].pageX, ts[0].pageY), false);
  };
  const onTouchMove = (e: any) => {
    const ts = e.nativeEvent.touches;
    if (pinch.current && ts.length >= 2) {
      const p = pinch.current;
      const d = Math.hypot(ts[0].pageX - ts[1].pageX, ts[0].pageY - ts[1].pageY) || 1;
      const mid = { x: (ts[0].pageX + ts[1].pageX) / 2, y: (ts[0].pageY + ts[1].pageY) / 2 };
      const s = Math.max(0.1, Math.min(8, p.s0 * (d / p.d0)));
      const f = s / p.s0;
      const mx = p.mid.x - stagePos.current.px, my = p.mid.y - stagePos.current.py;
      setTr({ s, tx: (mx - f * (mx - p.tx0)) + (mid.x - p.mid.x), ty: (my - f * (my - p.ty0)) + (mid.y - p.mid.y) });
      return;
    }
    if (ts.length === 1 && !pinch.current) actions.current.pointerMove(toRel(ts[0].pageX, ts[0].pageY));
  };
  const onTouchEnd = (e: any) => {
    if (e.nativeEvent.touches.length === 0) {
      if (pinch.current) { pinch.current = null; return; }
      actions.current.pointerUp();
    }
  };
  const onStageLayout = () => {
    const n: any = stageRef.current;
    if (n?.measureInWindow) n.measureInWindow((x: number, y: number, w: number, h: number) => {
      stagePos.current = { px: x, py: y }; stageSize.current = { w, h };
    });
  };
  useEffect(() => { setTimeout(fit, 300); /* initial fit */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { ghosts, codes } = dupPreview();
  const gridLines: number[] = [];
  const gridLinesY: number[] = [];
  if (snapOn) {
    const { sx, sy } = stepRel();
    if (sx >= 0.005) { for (let v = sx; v < 1; v += sx) gridLines.push(v); for (let v = sy; v < 1; v += sy) gridLinesY.push(v); }
  }

  const renderShape = (el: any) => {
    let g = toGeom(el);
    if (dragDelta && sel[el.id]) g = { ...g, x: g.x + dragDelta.dx, y: g.y + dragDelta.dy };
    if (resizePrev && resizePrev.id === el.id) g = resizePrev.g;
    return (
      <ShapeView key={el.id} id={el.id} x={g.x} y={g.y} w={g.w} h={g.h} punkt={g.punkt} kod={el.kod}
        color={elementStatusColor(el.status)} isSel={!!sel[el.id]} single={selIds.length === 1}
        W={W} H={H} s={tr.s} />
    );
  };

  const selectTool = useCallback((id: any) => { setTool(id); setDrawStart(null); }, []);

  return (
    <View style={st.root}>
      {/* toolbar — grouped, compact (icon-only) below 1100px, horizontal scroll as safety net */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.toolbar} contentContainerStyle={st.toolbarRow}>
        {/* tryby */}
        <ToolBtn id="select" icon="hand-left-outline" label={t("tool_select")} active={tool === "select"} onSelect={selectTool} compact={compact} />
        <ToolBtn id="punkt" icon="pin-outline" label={t("tool_point")} active={tool === "punkt"} onSelect={selectTool} compact={compact} />
        <ToolBtn id="prostokat" icon="square-outline" label={t("tool_rect")} active={tool === "prostokat"} onSelect={selectTool} compact={compact} />
        <View style={st.sep} />
        {/* historia */}
        <ActBtn id="undo" icon="arrow-undo-outline" label="Ctrl+Z" onPress={undo} compact={compact} />
        <ActBtn id="redo" icon="arrow-redo-outline" label="Ctrl+Y" onPress={redo} compact={compact} />
        <View style={st.sep} />
        {/* wyrównanie */}
        <ActBtn id="al-left" icon="chevron-back-outline" label={t("align_left")} onPress={() => arrange("left")} disabled={selIds.length < 2} compact={compact} />
        <ActBtn id="al-hc" icon="remove-outline" label={t("align_hcenter")} onPress={() => arrange("hcenter")} disabled={selIds.length < 2} compact={compact} />
        <ActBtn id="al-right" icon="chevron-forward-outline" label={t("align_right")} onPress={() => arrange("right")} disabled={selIds.length < 2} compact={compact} />
        <ActBtn id="al-top" icon="chevron-up-outline" label={t("align_top")} onPress={() => arrange("top")} disabled={selIds.length < 2} compact={compact} />
        <ActBtn id="al-vc" icon="reorder-two-outline" label={t("align_vcenter")} onPress={() => arrange("vcenter")} disabled={selIds.length < 2} compact={compact} />
        <ActBtn id="al-bottom" icon="chevron-down-outline" label={t("align_bottom")} onPress={() => arrange("bottom")} disabled={selIds.length < 2} compact={compact} />
        <View style={st.sep} />
        {/* rozmieszczanie / lustro */}
        <ActBtn id="dist-h" icon="swap-horizontal-outline" label={t("distribute_h")} onPress={() => arrange("disth")} disabled={selIds.length < 3} compact={compact} />
        <ActBtn id="dist-v" icon="swap-vertical-outline" label={t("distribute_v")} onPress={() => arrange("distv")} disabled={selIds.length < 3} compact={compact} />
        <ActBtn id="same-size" icon="resize-outline" label={t("same_size")} onPress={() => arrange("same")} disabled={selIds.length < 2} compact={compact} />
        <ActBtn id="mirror-h" icon="repeat-outline" label={t("mirror_h")} onPress={() => arrange("mirrorh")} disabled={selIds.length < 1} compact={compact} />
        <ActBtn id="mirror-v" icon="sync-outline" label={t("mirror_v")} onPress={() => arrange("mirrorv")} disabled={selIds.length < 1} compact={compact} />
        <View style={st.sep} />
        {/* edycja */}
        <ActBtn id="dup-grid" icon="grid-outline" label={t("dup_grid")} onPress={() => { setDup({ mode: "grid" }); setCollisions([]); }} disabled={selIds.length !== 1 || toGeom(selEls[0] || {}).punkt} compact={compact} />
        <ActBtn id="dup-line" icon="ellipsis-horizontal-outline" label={t("dup_line")} onPress={() => { setDup({ mode: "line" }); setCollisions([]); }} disabled={selIds.length !== 1 || toGeom(selEls[0] || {}).punkt} compact={compact} />
        <ActBtn id="edit-data" icon="create-outline" label={t("edit_data")} onPress={() => { const e = selEls[0]; setKod(e.kod); setTypId(e.typ_id); setOpis(e.opis || ""); setForm({ geom: toGeom(e), el: e }); }} disabled={selIds.length !== 1} compact={compact} />
        <ActBtn id="delete" icon="trash-outline" label="Del" onPress={() => setDelOpen(true)} disabled={selIds.length < 1} compact={compact} />
        <View style={st.sep} />
        {/* siatka */}
        <Pressable testID="snap-toggle" onPress={() => setSnapOn((v) => !v)} style={[st.toolBtn, snapOn && st.toolBtnOn]}>
          <Ionicons name="apps-outline" size={16} color={snapOn ? "#fff" : colors.onSurfaceSecondary} />
          {!compact && <Text style={[st.toolText, snapOn && { color: "#fff" }]}>{t("snap_grid")}</Text>}
        </Pressable>
        <TextInput testID="snap-step" value={snapStep} onChangeText={setSnapStep} style={st.snapInput} keyboardType="numeric" />
        <Text style={st.toolText}>%</Text>
        <View style={st.sep} />
        {/* widok */}
        <ActBtn id="fit" icon="scan-outline" label={t("fit_screen")} onPress={fit} compact={compact} />
        <ActBtn id="zoom100" icon="search-outline" label="100%" onPress={() => setTr({ s: 1, tx: 0, ty: 0 })} compact={compact} />
        <ActBtn id="zoom-in" icon="add-outline" label={t("zoom_in")} onPress={() => zoomBy(1.25)} compact={compact} />
        <ActBtn id="zoom-out" icon="remove-circle-outline" label={t("zoom_out")} onPress={() => zoomBy(1 / 1.25)} compact={compact} />
      </ScrollView>

      {/* stage */}
      <View
        ref={stageRef}
        style={st.stage}
        testID="editor-stage"
        onLayout={onStageLayout}
        {...(Platform.OS !== "web" ? { onTouchStart, onTouchMove, onTouchEnd } : {})}
      >
        <View style={[st.content, { width: W, height: H, transform: [{ translateX: tr.tx }, { translateY: tr.ty }, { scale: tr.s }], transformOrigin: "0 0" } as any]}>
          {imgError ? (
            <View style={[st.imgFallback, { width: W, height: H }]}>
              <Ionicons name="image-outline" size={48} color={colors.muted} />
              <Text style={st.fallbackText}>{t("image_load_failed")}</Text>
            </View>
          ) : (
            <View pointerEvents="none">
              <Image source={{ uri: fileUrl(view.plik_url) }} style={{ width: W, height: H }} contentFit="fill" onError={() => setImgError(true)} />
            </View>
          )}
          {gridLines.map((v) => <View key={`gx${v}`} style={[st.gridLine, { left: v * W, top: 0, width: 1, height: H }]} pointerEvents="none" />)}
          {gridLinesY.map((v) => <View key={`gy${v}`} style={[st.gridLine, { top: v * H, left: 0, height: 1, width: W }]} pointerEvents="none" />)}
          {els.map(renderShape)}
          {ghosts.map((g, i) => (
            <View key={`gh${i}`} pointerEvents="none" style={[st.rect, { left: g.x * W, top: g.y * H, width: g.w * W, height: g.h * H, borderColor: colors.brand, borderWidth: 2, borderStyle: "dashed" as any, backgroundColor: colors.brand + "22" }]}>
              <Text style={[st.rectLabel, { color: colors.brand }]} numberOfLines={1}>{codes[i]}</Text>
            </View>
          ))}
          {drawStart && (
            <View pointerEvents="none" style={[st.rect, {
              left: Math.min(drawStart.x, mouse.x) * W, top: Math.min(drawStart.y, mouse.y) * H,
              width: Math.abs(mouse.x - drawStart.x) * W, height: Math.abs(mouse.y - drawStart.y) * H,
              borderColor: colors.brand, borderWidth: 2, borderStyle: "dashed" as any, backgroundColor: colors.brand + "22",
            }]} />
          )}
          {marquee && (
            <View pointerEvents="none" style={[st.rect, {
              left: Math.min(marquee.x0, marquee.x1) * W, top: Math.min(marquee.y0, marquee.y1) * H,
              width: Math.abs(marquee.x1 - marquee.x0) * W, height: Math.abs(marquee.y1 - marquee.y0) * H,
              borderColor: "#fff", borderWidth: 1, borderStyle: "dashed" as any, backgroundColor: "rgba(255,255,255,0.08)",
            }]} />
          )}
        </View>
        {/* cursor coords (F5) */}
        <View style={st.coords} pointerEvents="none">
          <Text style={st.coordsText}>{mouse.x.toFixed(3)} · {mouse.y.toFixed(3)} · {(tr.s * 100).toFixed(0)}%</Text>
        </View>
        {drawStart && <View style={st.hintBar} pointerEvents="none"><Text style={st.hintText}>{t("rect_second_click")}</Text></View>}
      </View>

      {/* create/edit form */}
      <Modal visible={!!form} transparent animationType="fade" onRequestClose={() => setForm(null)}>
        <View style={st.backdrop}>
          <View style={st.sheet}>
            <Text style={st.sheetTitle}>{form?.el ? t("edit_data") : t("add_element")}</Text>
            <TextInput testID="w-element-code" value={kod} onChangeText={setKod} placeholder={t("code")} placeholderTextColor={colors.muted} style={st.input} autoFocus />
            <SelectField testID="w-element-type" value={types.find((x) => x.id === typId)?.[lang === "pl" ? "nazwa_pl" : "nazwa_en"]} placeholder={t("element_type")} onPress={() => setTypePicker(true)} />
            <TextInput testID="w-element-opis" value={opis} onChangeText={setOpis} placeholder={t("description")} placeholderTextColor={colors.muted} style={st.input} />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <Button title={t("cancel")} onPress={() => setForm(null)} variant="secondary" style={{ flex: 1 }} />
              <Button title={t("save")} onPress={saveForm} style={{ flex: 1 }} testID="w-save-element" />
            </View>
          </View>
        </View>
      </Modal>

      {/* duplicate modal */}
      <Modal visible={!!dup} transparent animationType="fade" onRequestClose={() => setDup(null)}>
        <View style={[st.backdrop, { justifyContent: "flex-start", paddingTop: 80, alignItems: "flex-end", paddingRight: 24 }]}>
          <View style={[st.sheet, { width: 340 }]}>
            <Text style={st.sheetTitle}>{dup?.mode === "grid" ? t("dup_grid") : t("dup_line")}</Text>
            {dup?.mode === "grid" ? (
              <View style={st.row2}>
                <Field label={t("columns")} value={cols} onChange={setCols} testID="dup-cols" />
                <Field label={t("rows")} value={rows} onChange={setRows} testID="dup-rows" />
              </View>
            ) : (
              <View style={st.row2}>
                <Field label={t("copies")} value={count} onChange={setCount} testID="dup-count" />
                <View style={{ flex: 1 }}>
                  <Text style={st.fieldLabel}>{t("direction")}</Text>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <Pressable testID="dir-h" onPress={() => setDir("h")} style={[st.dirBtn, dir === "h" && st.toolBtnOn]}><Text style={[st.toolText, dir === "h" && { color: "#fff" }]}>→</Text></Pressable>
                    <Pressable testID="dir-v" onPress={() => setDir("v")} style={[st.dirBtn, dir === "v" && st.toolBtnOn]}><Text style={[st.toolText, dir === "v" && { color: "#fff" }]}>↓</Text></Pressable>
                  </View>
                </View>
              </View>
            )}
            <View style={st.row2}>
              <Field label={t("gap_h")} value={gapX} onChange={setGapX} testID="dup-gapx" />
              <Field label={t("gap_v")} value={gapY} onChange={setGapY} testID="dup-gapy" />
            </View>
            <View style={st.row2}>
              <Field label={t("series_prefix")} value={prefix} onChange={setPrefix} testID="dup-prefix" numeric={false} />
              <Field label={t("start_number")} value={startNum} onChange={setStartNum} testID="dup-start" />
            </View>
            <Text style={st.previewInfo}>{t("dup_preview_info").replace("{n}", String(ghosts.length))}</Text>
            {collisions.length > 0 && (
              <Text testID="dup-collisions" style={st.collisions}>{t("codes_taken_list")}: {collisions.slice(0, 10).join(", ")}</Text>
            )}
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <Button title={t("cancel")} onPress={() => { setDup(null); setCollisions([]); }} variant="secondary" style={{ flex: 1 }} />
              <Button title={t("create_series")} onPress={confirmDup} style={{ flex: 1 }} testID="dup-confirm" disabled={!ghosts.length} />
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmModal
        visible={delOpen}
        title={t("delete")}
        message={t("archive_selected_confirm").replace("{n}", String(selIds.length))}
        confirmLabel={t("delete")} cancelLabel={t("cancel")} danger
        onConfirm={() => archiveSelected()} onCancel={() => setDelOpen(false)}
      />
      <SelectSheet visible={typePicker} title={t("element_type")} options={types.map((x) => ({ value: x.id, label: x[lang === "pl" ? "nazwa_pl" : "nazwa_en"] }))} selected={typId} onSelect={setTypId} onClose={() => setTypePicker(false)} />
    </View>
  );
}

function Field({ label, value, onChange, testID, numeric = true }: any) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={st.fieldLabel}>{label}</Text>
      <TextInput testID={testID} value={value} onChangeText={onChange} style={st.input} keyboardType={numeric ? "numeric" : "default"} placeholderTextColor={colors.muted} />
    </View>
  );
}

// Top-level (stable identity) toolbar buttons — defining them inside the editor
// would remount them on every mousemove render and break the press cycle.
function ToolBtn({ id, icon, label, active, onSelect, compact }: any) {
  return (
    <Pressable testID={`tool-${id}`} onPress={() => onSelect(id)} style={[st.toolBtn, active && st.toolBtnOn]} accessibilityLabel={label}>
      <Ionicons name={icon} size={16} color={active ? "#fff" : colors.onSurfaceSecondary} />
      {!compact && <Text style={[st.toolText, active && { color: "#fff" }]}>{label}</Text>}
    </Pressable>
  );
}

function ActBtn({ id, icon, label, onPress, disabled, compact }: any) {
  return (
    <Pressable testID={`act-${id}`} onPress={onPress} disabled={disabled} style={[st.toolBtn, disabled && { opacity: 0.35 }]} accessibilityLabel={label}>
      <Ionicons name={icon} size={16} color={colors.onSurfaceSecondary} />
      {!compact && <Text style={st.toolText}>{label}</Text>}
    </Pressable>
  );
}

// Memoized shape — 200+ shapes must not re-render on every cursor move (I.13).
const ShapeView = React.memo(function ShapeView({ id, x, y, w, h, punkt, kod, color, isSel, single, W, H, s }: any) {
  if (punkt) {
    return (
      <View testID={`wshape-${id}`} style={[st.point, { left: x * W - 12, top: y * H - 12, backgroundColor: color, borderColor: isSel ? "#fff" : "rgba(0,0,0,0.4)", borderWidth: isSel ? 2 : 1 }]} pointerEvents="none">
        <Text style={st.pointText} numberOfLines={1}>{kod}</Text>
      </View>
    );
  }
  return (
    <View testID={`wshape-${id}`} pointerEvents="none" style={[st.rect, {
      left: x * W, top: y * H, width: w * W, height: h * H,
      borderColor: isSel ? "#fff" : color, borderWidth: isSel ? 3 : 2,
      backgroundColor: color + "4D",
    }]}>
      {w * W * s > 28 && <Text style={st.rectLabel} numberOfLines={1}>{kod}</Text>}
      {isSel && single && [0, 1, 2, 3].map((i) => (
        <View key={i} testID={`whandle-${i}-${id}`} style={[st.handle, { left: (i === 0 || i === 3 ? 0 : w * W) - 5, top: (i < 2 ? 0 : h * H) - 5 }]} />
      ))}
    </View>
  );
});

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  toolbar: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.surfaceSecondary },
  toolbarRow: { flexDirection: "row", alignItems: "center", gap: 6, padding: spacing.sm },
  toolBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.surface },
  toolBtnOn: { backgroundColor: colors.brand },
  toolText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  sep: { width: 1, height: 24, backgroundColor: colors.divider, marginHorizontal: 4 },
  snapInput: { width: 46, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: 6, paddingVertical: 6, fontSize: 12 },
  stage: { flex: 1, overflow: "hidden", backgroundColor: "#0A0A0A", cursor: "crosshair" as any },
  content: { position: "absolute" },
  gridLine: { position: "absolute", backgroundColor: "rgba(249,115,22,0.25)" },
  rect: { position: "absolute", alignItems: "center", justifyContent: "center" },
  rectLabel: { color: "#fff", fontSize: 11, fontWeight: "800", textShadowColor: "#000", textShadowRadius: 3 },
  handle: { position: "absolute", width: 10, height: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.brand },
  point: { position: "absolute", minWidth: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  pointText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  coords: { position: "absolute", right: 8, bottom: 8, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  coordsText: { color: colors.onSurfaceSecondary, fontSize: 11, fontVariant: ["tabular-nums"] },
  hintBar: { position: "absolute", top: 8, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.7)", borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 6 },
  hintText: { color: colors.brand, fontSize: 12, fontWeight: "700" },
  imgFallback: { alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary },
  fallbackText: { color: colors.muted, fontSize: font.base },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: spacing.xl },
  sheet: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md, width: 400, maxWidth: "100%" },
  sheetTitle: { color: colors.onSurface, fontSize: font.xl, fontWeight: "800" },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.onSurface, fontSize: font.base },
  row2: { flexDirection: "row", gap: spacing.md },
  fieldLabel: { color: colors.muted, fontSize: font.sm, marginBottom: 4 },
  dirBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.surface },
  previewInfo: { color: colors.onSurfaceSecondary, fontSize: font.sm },
  collisions: { color: colors.error, fontSize: font.sm },
});
