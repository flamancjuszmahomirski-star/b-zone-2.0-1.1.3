// R2: mobile view = READ + report/receive selection ONLY. The geometry editor is
// ABSENT on the phone (no route, no mode, no entry) — it exists exclusively on
// web for the admin role (GeometryEditor). Enforced also on the backend.
import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, Modal, Dimensions, Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from "react-native-reanimated";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { colors, spacing, font, radius, elementStatusColor } from "@/src/theme/tokens";
import { useI18n } from "@/src/i18n/I18nContext";
import { useAuth } from "@/src/context/AuthContext";
import { api, fileUrl } from "@/src/api/client";
import { Header } from "@/src/components/Screen";
import { Button } from "@/src/components/Button";
import { LoadingState } from "@/src/components/States";
import { useToast } from "@/src/components/Toast";
import { GeometryEditor } from "@/src/components/web/GeometryEditor";
import { useIsTablet } from "@/src/hooks/use-is-tablet";

const SCREEN = Dimensions.get("window");

// G: rectangle as a plain View — constant visual border width (independent of zoom),
// ~30% translucent fill, label hidden below a zoom threshold, ≥48dp touch target.
const RectShape = React.memo(function RectShape({ el, baseW, baseH, jsScale, isSel, isFocus, onPress }: any) {
  const pts = el.geometria_json?.punkty || [];
  const xs = pts.map((p: any) => p.x), ys = pts.map((p: any) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  const w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  const c = elementStatusColor(el.status);
  const borderW = Math.max(1, 2 / jsScale); // constant on-screen thickness
  const screenW = w * baseW * jsScale, screenH = h * baseH * jsScale;
  // 48dp minimum touch target (gloves): extend hit area in local (pre-scale) units.
  const slopX = screenW < 48 ? (48 - screenW) / (2 * jsScale) : 0;
  const slopY = screenH < 48 ? (48 - screenH) / (2 * jsScale) : 0;
  const showLabel = screenW > 34; // zoom threshold for labels; shape always rendered
  return (
    <Pressable
      testID={`shape-${el.id}`}
      onPress={() => onPress(el)}
      hitSlop={{ left: slopX, right: slopX, top: slopY, bottom: slopY }}
      style={[styles.rect, {
        left: x * baseW, top: y * baseH, width: w * baseW, height: h * baseH,
        borderWidth: isFocus ? borderW + 2 / jsScale : isSel ? borderW + 1 / jsScale : borderW,
        borderColor: isSel || isFocus ? "#fff" : c,
        backgroundColor: c + "4D",
        zIndex: isFocus ? 10 : undefined,
      }]}
    >
      {showLabel && <Text style={styles.rectLabel} numberOfLines={1}>{el.kod}</Text>}
    </Pressable>
  );
});

export default function ViewCanvas() {
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const { t } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const canReceive = user?.rola === "admin" || user?.rola === "foreman";
  // R2.1 (BLOK 1): editor = admin AND (web with desktop/tablet-sized window OR native tablet).
  // Phone (native or narrow web window) = preview only. Enforced also on the backend.
  const isTablet = useIsTablet();
  const { width: winW, height: winH } = useWindowDimensions();
  const isWebAdmin = user?.rola === "admin" && (
    Platform.OS === "web" ? Math.min(winW, winH) >= 600 : isTablet
  );

  const [view, setView] = useState<any>(null);
  const [elements, setElements] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"view" | "receive">("view");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<any>(null);
  const [imgError, setImgError] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  // JS-side zoom mirror (updated at gesture end) for constant border/labels/hit areas.
  const [jsScale, setJsScale] = useState(1);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const stx = useSharedValue(0);
  const sty = useSharedValue(0);

  const baseW = SCREEN.width;
  const [baseH, setBaseH] = useState(SCREEN.width * 0.75);

  const load = useCallback(async () => {
    try {
      const [v, ty2] = await Promise.all([api(`/views/${id}`), api("/element-types")]);
      setView(v); setElements(v.elementy || []); setTypes(ty2);
      const bh = v.szerokosc && v.wysokosc ? SCREEN.width * (v.wysokosc / v.szerokosc) : SCREEN.width * 0.75;
      if (v.szerokosc && v.wysokosc) setBaseH(bh);
      // H7: center + zoom on the focused element (works for points AND rectangles —
      // pozycja_x/y is always the shape center).
      if (focus) {
        const fel = (v.elementy || []).find((e: any) => e.id === focus);
        if (fel) {
          setFocusId(fel.id);
          const s = 2;
          const txv = s * (SCREEN.width / 2 - fel.pozycja_x * SCREEN.width);
          const tyv = s * (bh / 2 - fel.pozycja_y * bh);
          scale.value = withTiming(s); savedScale.value = s;
          tx.value = withTiming(txv); stx.value = txv;
          ty.value = withTiming(tyv); sty.value = tyv;
          setJsScale(s);
          setDetail(fel);
        }
      }
    } catch { setView(null); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, focus]);
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const syncScale = (v: number) => setJsScale(v);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => { scale.value = Math.max(1, Math.min(6, savedScale.value * e.scale)); })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) { scale.value = withTiming(1); tx.value = withTiming(0); ty.value = withTiming(0); stx.value = 0; sty.value = 0; }
      runOnJS(syncScale)(Math.max(1, scale.value));
    });
  const pan = Gesture.Pan().minPointers(scale.value > 1 ? 1 : 2)
    .onUpdate((e) => { tx.value = stx.value + e.translationX; ty.value = sty.value + e.translationY; })
    .onEnd(() => { stx.value = tx.value; sty.value = ty.value; });
  const composed = Gesture.Simultaneous(pinch, pan);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const onShapePress = (el: any) => {
    if (mode === "receive") {
      if (el.status !== "zgloszony_gotowy") { toast.show(t("st_zgloszony_gotowy"), "info"); return; }
      setSelected((s) => ({ ...s, [el.id]: !s[el.id] }));
    } else {
      setDetail(el);
    }
  };

  const receiveSelected = async () => {
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (!ids.length) return;
    try {
      const r = await api<{ odebrano: number }>(`/projects/${view.project_id}/elements/receive`, { method: "POST", body: { element_ids: ids } });
      toast.show(`${t("receive")}: ${r.odebrano}`); setSelected({}); setMode("view"); load();
    } catch (e: any) { toast.show(e.message || t("error_generic"), "error"); }
  };

  if (loading) return <View style={styles.screen}><Header title={t("view")} back /><LoadingState /></View>;
  if (!view) return <View style={styles.screen}><Header title={t("view")} back /></View>;

  const counts = {
    todo: elements.filter((e) => e.status === "do_wykonania").length,
    ready: elements.filter((e) => e.status === "zgloszony_gotowy").length,
    recv: elements.filter((e) => e.status === "odebrany").length,
  };
  const selCount = Object.values(selected).filter(Boolean).length;

  // R2 (D/E): web + admin → mouse/keyboard geometry editor instead of the touch canvas.
  if (isWebAdmin) {
    return (
      <View style={styles.screen}>
        <Header title={view.nazwa} back />
        <View style={styles.legend}>
          <Legend color={colors.muted} label={`${t("st_do_wykonania")} ${counts.todo}`} />
          <Legend color={colors.warning} label={`${t("st_zgloszony_gotowy")} ${counts.ready}`} />
          <Legend color={colors.success} label={`${t("st_odebrany")} ${counts.recv}`} />
        </View>
        <GeometryEditor view={view} elements={elements} types={types} reload={load} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Header title={view.nazwa} back />

      <View style={styles.legend}>
        <Legend color={colors.muted} label={`${t("st_do_wykonania")} ${counts.todo}`} />
        <Legend color={colors.warning} label={`${t("st_zgloszony_gotowy")} ${counts.ready}`} />
        <Legend color={colors.success} label={`${t("st_odebrany")} ${counts.recv}`} />
      </View>

      <View style={styles.canvasWrap}>
        <GestureDetector gesture={composed}>
          <Animated.View style={[{ width: baseW, height: baseH }, animStyle]}>
            {imgError ? (
              <View style={[styles.imgFallback, { width: baseW, height: baseH }]}>
                <Ionicons name="image-outline" size={40} color={colors.muted} />
                <Text style={styles.imgFallbackTitle}>{t("file_lost")}</Text>
                <Text style={styles.imgFallbackText}>{t("image_load_failed")}</Text>
              </View>
            ) : (
              <Image
                source={{ uri: fileUrl(view.plik_url) }}
                style={{ width: baseW, height: baseH }}
                contentFit="contain"
                onError={() => setImgError(true)}
              />
            )}
            {elements.map((el) => {
              if (el.geometria_typ === "prostokat" && el.geometria_json?.punkty?.length === 4) {
                return (
                  <RectShape key={el.id} el={el} baseW={baseW} baseH={baseH} jsScale={jsScale}
                    isSel={!!selected[el.id]} isFocus={el.id === focusId} onPress={onShapePress} />
                );
              }
              const c = elementStatusColor(el.status);
              const isSel = selected[el.id];
              const isFocus = el.id === focusId;
              return (
                <Pressable
                  key={el.id}
                  testID={`marker-${el.id}`}
                  onPress={() => onShapePress(el)}
                  style={[styles.marker, {
                    left: el.pozycja_x * baseW - 12, top: el.pozycja_y * baseH - 12,
                    backgroundColor: c,
                    borderColor: isFocus || isSel ? "#fff" : "rgba(0,0,0,0.4)",
                    borderWidth: isFocus ? 3 : isSel ? 2 : 1,
                    zIndex: isFocus ? 10 : undefined,
                  }]}
                >
                  <Text style={styles.markerText} numberOfLines={1}>{el.kod}</Text>
                </Pressable>
              );
            })}
          </Animated.View>
        </GestureDetector>
      </View>

      {canReceive && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
          {mode === "receive" ? (
            <>
              <Button title={t("cancel")} onPress={() => { setMode("view"); setSelected({}); }} variant="secondary" style={{ flex: 1 }} />
              <Button title={`${t("receive_selected")} (${selCount})`} onPress={receiveSelected} disabled={selCount === 0} style={{ flex: 2 }} testID="receive-selected" />
            </>
          ) : (
            <Button title={t("receipts")} icon="checkmark-circle-outline" onPress={() => setMode("receive")} disabled={counts.ready === 0} testID="enter-receive" />
          )}
        </View>
      )}

      {/* element detail sheet */}
      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <Pressable style={styles.backdrop} onPress={() => setDetail(null)}>
          <Pressable style={styles.detailSheet} onPress={() => {}}>
            <View style={styles.handle} />
            <View style={styles.detailHead}>
              <View style={[styles.dot, { backgroundColor: elementStatusColor(detail?.status) }]} />
              <Text style={styles.detailKod}>{detail?.kod}</Text>
            </View>
            <Text style={styles.detailStatus}>{t(`st_${detail?.status}` as any) || detail?.status}</Text>
            <Button title={t("timeline")} icon="time-outline" variant="secondary" onPress={() => { const d = detail; setDetail(null); router.push(`/element/${d.id}`); }} testID="element-timeline" />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  legend: { flexDirection: "row", justifyContent: "space-around", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: colors.onSurfaceSecondary, fontSize: font.sm },
  canvasWrap: { flex: 1, backgroundColor: "#0A0A0A", overflow: "hidden", justifyContent: "center" },
  marker: { position: "absolute", minWidth: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  markerText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  rect: { position: "absolute", alignItems: "center", justifyContent: "center" },
  rectLabel: { color: "#fff", fontSize: 9, fontWeight: "800", textShadowColor: "#000", textShadowRadius: 3 },
  imgFallback: { alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary },
  imgFallbackTitle: { color: colors.onSurface, fontSize: font.lg, fontWeight: "800" },
  imgFallbackText: { color: colors.muted, fontSize: font.sm, textAlign: "center", paddingHorizontal: spacing.xl },
  footer: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: spacing.xl },
  detailSheet: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: colors.surfaceTertiary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.md },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: "center" },
  detailHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 14, height: 14, borderRadius: 7 },
  detailKod: { color: colors.onSurface, fontSize: font.xxl, fontWeight: "800" },
  detailStatus: { color: colors.muted, fontSize: font.lg },
});
