import { useState, useEffect, useLayoutEffect, useRef, type ReactNode, type SyntheticEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Settings, Menu, X, Power,
    ChevronUp, ChevronDown, KeyRound, User,
  LayoutDashboard, CalendarDays, PawPrint, Receipt, Scissors, Package, BarChart3, Users,
  type LucideIcon,
} from "lucide-react";
import { useAdminStore } from "@/store/adminStore";
import { NotificationBell } from "@/components/NotificationBell";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import { useNotBilledCount } from "@/hooks/useNotBilledCount";

const THEME_ID = "pet-royale-theme";

const THEME_CSS = `
      /* DM Sans and Fraunces are bundled with the app (@fontsource, imported
         in main.tsx), not fetched from Google — the site's Content Security
         Policy blocks outside stylesheets. */

      :root {
        /* Logo palette: navy, gold and cream, taken from the crest's pixels.
            Brand tokens only (primary, accent, ring, text). Status colours keep
            their own meaning: destructive stays red, and the green/amber/blue
            used on status pills are untouched. */
        --background: 42 32% 93%;
        --foreground: 215 30% 16%;
        --border: 41 23% 83%;
        --input: 41 23% 80%;
        --ring: 215 55% 32%;
        --card: 40 36% 97%;
        --card-foreground: 215 30% 16%;
        --card-border: 41 23% 85%;
        --popover: 40 36% 97%;
        --popover-foreground: 215 30% 16%;
        --primary: 215 86% 14%;
        --primary-foreground: 49 33% 95%;
        --secondary: 86 44% 78%;
        --secondary-foreground: 215 30% 16%;
        --muted: 40 23% 88%;
        --muted-foreground: 173 14% 35%;
        --accent: 43 72% 53%;
        --accent-foreground: 215 40% 15%;
        --destructive: 3 65% 54%;
        --destructive-foreground: 42 32% 96%;
        --radius: 1rem;
      }

      /* The Vite template caps #root and centres its text. Undone here. */
      #root {
        max-width: none;
        margin: 0;
        padding: 0;
        text-align: left;
      }

      html { min-width: 320px; background: hsl(var(--background)); }

      body {
        margin: 0;
        font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        -webkit-font-smoothing: antialiased;
      }

      button, input, select, textarea { font: inherit; }

      button:focus-visible, input:focus-visible, select:focus-visible,
      textarea:focus-visible, a:focus-visible {
        outline: 3px solid hsl(var(--accent) / .55);
        outline-offset: 3px;
      }

      /* Fraunces on headings: the serif against the sans gives the design
         its character. */
      .display-face {
        font-family: 'Fraunces', Georgia, serif;
        letter-spacing: -.045em;
      }

      .workspace-shell {
        min-height: 100dvh;
        background: hsl(0 0% 100%);
      }

      .workspace-grid {
        display: none;
      }

      /* 88% opaque on purpose: cards sit on the textured page background.
         Floating menus and popovers must NOT use this class; use an explicit
         opaque background instead. */
      .workspace-card {
        border: 1px solid hsl(var(--card-border) / .82);
        background: hsl(var(--card) / .88);
        box-shadow:
          0 18px 50px -34px hsl(220 45% 18% / .42),
          0 2px 9px hsl(220 45% 18% / .035);
      }

      .workspace-topbar {
        background: linear-gradient(135deg, hsl(var(--primary) / .97), hsl(215 70% 8% / .98));
        backdrop-filter: blur(18px) saturate(160%);
        -webkit-backdrop-filter: blur(18px) saturate(160%);
        border-bottom: 1px solid hsl(var(--primary-foreground) / .14);
        box-shadow: 0 18px 40px -30px hsl(220 45% 12% / .55);
      }

      .workspace-scroll {
        scroll-behavior: smooth;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .workspace-scroll::-webkit-scrollbar { display: none; }

      /* The sidebar's own list scrolls without a visible track. */
      .sidebar-scroll { scrollbar-width: none; -ms-overflow-style: none; }
      .sidebar-scroll::-webkit-scrollbar { display: none; }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: .35rem;
        border-radius: 999px;
        padding: .35rem .62rem;
        font-size: .68rem;
        font-weight: 700;
        letter-spacing: .01em;
        white-space: nowrap;
      }

      .modal-backdrop {
        background: hsl(var(--foreground) / .42);
        backdrop-filter: blur(5px);
      }

      @keyframes workspace-rise {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .workspace-rise   { animation: workspace-rise 500ms cubic-bezier(.22,.8,.24,1) both; }
      .workspace-rise-1 { animation-delay: 70ms; }
      .workspace-rise-2 { animation-delay: 130ms; }
      .workspace-rise-3 { animation-delay: 190ms; }

      @keyframes entrance {
        from { opacity: 0; transform: translateY(12px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .entrance         { animation: entrance 650ms cubic-bezier(.22,.8,.24,1) both; }
      .entrance-delay-1 { animation-delay: 100ms; }
      .entrance-delay-2 { animation-delay: 180ms; }
      .entrance-delay-3 { animation-delay: 260ms; }

      .login-shell {
        position: relative;
        isolation: isolate;
        min-height: 100dvh;
        overflow: hidden;
        background:
          radial-gradient(circle at 8% 18%, hsl(var(--secondary) / .42), transparent 25rem),
          radial-gradient(circle at 94% 88%, hsl(var(--accent) / .13), transparent 25rem),
          hsl(var(--background));
      }

      .soft-card {
        box-shadow:
          0 26px 80px -30px hsl(220 45% 18% / .3),
          0 4px 14px hsl(220 45% 18% / .06);
      }

      .guided-tilt { transform: rotate(1.2deg); }

      .appointment-line { position: relative; }
      .appointment-line::before {
        position: absolute;
        top: 1.8rem; bottom: -1.5rem; left: .7rem;
        width: 1px; content: '';
        background: hsl(var(--primary-foreground) / .19);
      }
      .appointment-line:last-child::before { display: none; }

      .landing-shell {
        position: relative;
        isolation: isolate;
        background:
          radial-gradient(circle at 12% 8%, hsl(var(--secondary) / .38), transparent 28rem),
          radial-gradient(circle at 88% 42%, hsl(var(--accent) / .1), transparent 26rem),
          hsl(var(--background));
      }

      .landing-service { transition: transform .35s cubic-bezier(.22,.8,.24,1), box-shadow .35s ease; }
      .landing-service:hover {
        transform: translateY(-6px);
        box-shadow: 0 26px 60px -34px hsl(220 45% 18% / .4);
      }

      .landing-deep { background: linear-gradient(180deg, hsl(var(--primary)), hsl(215 70% 8%)); }

      @media (prefers-reduced-motion: reduce) {
        .workspace-rise, .entrance { animation: none; }
        .landing-service:hover { transform: none; }
      }
`;

/* Injected into <head> once and left there, so a tab change doesn't remove
   and re-add the stylesheet (that caused a visible reflow). */
export function ThemeStyles() {
  useLayoutEffect(() => {
    let el = document.getElementById(THEME_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = THEME_ID;
      document.head.appendChild(el);
    }
    if (el.textContent !== THEME_CSS) el.textContent = THEME_CSS;
  }, []);
  return null;
}

const WORDMARK_PATH =
  "M801.2 67.4 L779.6 67.4 L765.2 67.0 L753.8 66.0 L749.6 66.2 L741.2 71.4 L731.8 78.2 L724.4 84.4 L720.0 88.8 L713.6 97.0 L708.2 106.4 L706.0 116.4 L706.2 126.8 L708.2 133.0 L712.6 139.8 L717.2 144.6 L721.6 148.0 L727.8 151.8 L740.4 157.4 L749.4 160.0 L758.2 161.6 L767.4 162.0 L770.2 161.4 L780.2 155.2 L784.8 153.0 L786.8 152.6 L795.4 147.8 L802.8 143.0 L806.2 139.8 L809.8 134.8 L815.4 123.8 L817.6 114.6 L818.0 105.2 L817.6 101.4 L816.2 95.8 L813.4 89.4 L807.8 82.6 L800.0 77.8 L798.6 76.4 L798.6 74.8 L802.0 68.8 L801.8 67.8Z M751.8 85.0 L754.6 84.8 L756.8 85.4 L766.4 89.6 L771.0 92.8 L775.6 97.8 L778.0 102.2 L779.8 107.4 L780.4 113.8 L780.0 128.0 L778.0 137.0 L776.8 138.2 L773.6 138.4 L770.8 137.2 L767.8 136.8 L763.4 135.0 L758.2 132.0 L752.0 126.4 L747.8 120.2 L745.0 111.4 L745.0 99.8 L747.8 90.2 L750.4 86.0Z M829.8 72.0 L828.6 73.4 L829.0 114.6 L830.4 136.0 L832.6 152.8 L833.4 153.8 L836.6 155.6 L846.0 157.8 L848.6 158.0 L850.2 157.6 L851.4 156.4 L852.4 153.2 L856.4 148.2 L867.8 135.8 L879.4 122.0 L881.8 119.6 L883.0 119.4 L883.6 120.0 L884.0 123.4 L883.4 130.8 L883.4 144.0 L884.0 159.0 L884.6 162.0 L85.4 175.4 L884.2 177.4 L882.0 177.8 L869.4 176.0 L857.4 173.6 L848.0 171.0 L842.8 168.6 L838.0 165.0 L835.6 164.4 L833.4 166.0 L825.8 175.2 L822.0 181.2 L822.0 183.6 L823.2 186.8 L827.6 195.8 L829.0 197.2 L840.8 203.4 L856.8 208.4 L861.6 209.0 L866.6 210.4 L879.0 212.2 L887.0 212.4 L890.6 209.8 L907.6 192.0 L915.4 181.2 L918.8 175.4 L920.8 170.2 L923.6 156.6 L926.8 128.0 L927.8 114.6 L928.6 111.0 L928.8 105.8 L930.4 96.8 L930.8 91.0 L931.8 87.6 L932.0 82.2 L933.4 76.2 L933.6 71.2 L932.8 70.2 L930.6 69.4 L917.8 69.0 L915.2 68.4 L901.2 67.8 L898.2 67.2 L893.0 67.4 L892.0 68.8 L887.4 87.2 L883.8 95.4 L875.0 110.2 L871.6 114.0 L870.8 114.0 L870.2 113.2 L870.0 108.2 L870.6 103.8 L871.0 90.2 L871.8 83.8 L872.0 74.2 L872.6 71.2 L872.2 66.6 L870.4 65.8 L862.2 68.0 L852.0 69.8Z M944.0 94.6 L940.4 102.6 L939.2 107.0 L938.2 114.8 L938.2 121.4 L939.0 135.4 L939.8 138.0 L940.0 143.2 L941.0 146.8 L941.4 151.8 L942.4 155.4 L944.2 157.0 L955.0 160.6 L961.6 162.2 L964.8 161.8 L983.2 145.2 L1003.0 126.0 L1004.2 126.2 L1005.0 127.8 L1005.0 141.2 L1003.6 161.8 L1004.4 163.2 L1007.0 163.4 L1014.0 161.2 L1018.8 160.6 L1033.0 156.8 L1041.2 155.6 L1043.4 154.4 L1043.8 153.0 L1043.2 144.0 L1043.8 120.0 L1043.4 99.2 L1042.2 93.2 L1040.0 87.0 L1036.2 81.0 L1030.8 76.6 L1025.2 73.6 L1011.6 70.2 L995.6 68.0 L981.6 65.2 L976.2 65.0 L974.2 65.8 L964.6 73.0 L955.8 80.6 L948.6 87.8Z M977.6 91.0 L988.2 93.4 L994.2 95.8 L1000.0 99.6 L1002.2 102.6 L1002.0 104.2 L1000.6 107.0 L994.6 115.4 L983.8 128.2 L980.0 131.4 L978.6 130.6 L978.0 129.2 L977.0 117.6 L976.8 105.6 L975.8 93.6 L976.6 91.6Z M1156.6 64.4 L1152.8 66.0 L1132.0 81.6 L1128.2 85.4 L1127.4 92.2 L1127.0 105.4 L1127.0 122.8 L1128.2 136.2 L1130.8 144.0 L1135.2 150.4 L1140.8 155.2 L1145.6 157.6 L1153.4 159.6 L1162.8 160.4 L1171.6 160.4 L1179.0 159.4 L1187.4 156.6 L1195.2 152.2 L1203.6 143.8 L1209.0 135.0 L1210.6 130.8 L1210.6 129.6 L1209.4 129.0 L1203.2 132.2 L1195.4 134.8 L1190.2 135.6 L1185.6 135.6 L1179.4 134.0 L1173.6 131.0 L1167.6 126.0 L1166.6 123.8 L1167.2 123.0 L1168.8 122.4 L1178.2 122.4 L1187.0 121.6 L1189.0 120.8 L1192.0 120.6 L1199.2 118.4 L1212.4 112.8 L1213.8 110.8 L1214.6 108.2 L1215.8 98.0 L1216.8 94.8 L1217.4 90.0 L1217.0 82.2 L1215.2 78.4 L1211.2 73.2 L1203.8 69.2 L1195.4 67.0 L1187.4 66.0Z M1165.6 86.6 L1169.8 86.2 L1174.8 88.0 L1178.4 90.0 L1182.2 94.0 L1183.8 96.8 L1184.8 101.6 L1184.8 110.0 L1183.8 111.6 L1180.8 112.4 L1163.6 112.6 L1162.2 111.4 L1162.0 107.0 L1163.8 95.6 L1164.0 89.4 L1164.6 87.6Z M265.4 64.4 L262.8 65.0 L261.0 66.0 L240.2 82.0 L236.4 85.6 L236.0 87.2 L235.2 110.2 L235.2 120.8 L236.2 134.8 L239.0 143.6 L241.0 147.2 L244.8 152.0 L250.8 156.2 L261.4 159.6 L270.4 160.4 L282.8 160.2 L292.6 157.8 L297.8 155.8 L307.0 149.0 L311.2 144.6 L315.0 139.2 L318.6 132.2 L319.0 129.2 L317.0 129.2 L309.0 133.4 L303.4 135.0 L297.8 135.6 L293.0 135.4 L288.6 134.4 L283.2 131.8 L278.6 128.6 L275.4 125.2 L275.0 123.6 L277.0 122.4 L291.6 122.0 L300.8 120.6 L315.0 115.6 L321.4 112.4 L322.6 110.4 L323.8 104.0 L324.0 98.8 L325.4 94.2 L326.0 88.4 L325.6 82.2 L323.2 77.6 L318.8 73.0 L315.2 70.4 L310.2 68.4 L299.0 66.2Z M273.8 86.8 L275.4 86.0 L276.8 86.0 L283.4 88.0 L286.0 89.4 L290.8 94.4 L292.4 97.6 L293.4 103.2 L293.2 109.8 L292.0 111.8 L290.8 112.2 L272.8 112.8 L271.0 111.8 L270.6 107.2 L271.4 103.4 L272.6 89.4Z M345.4 53.8 L343.6 55.0 L343.0 57.0 L342.6 71.8 L332.2 88.6 L332.2 89.8 L332.8 90.6 L340.0 90.6 L341.8 92.4 L341.2 103.2 L340.2 106.0 L340.0 112.8 L338.8 121.0 L338.8 129.2 L340.0 135.8 L345.4 145.0 L353.4 152.2 L364.6 158.0 L373.2 161.0 L378.0 161.8 L380.2 160.4 L384.8 153.8 L386.8 151.8 L398.0 135.6 L398.0 134.6 L397.0 133.4 L393.0 132.0 L385.8 128.2 L382.4 125.0 L379.4 120.6 L377.8 114.0 L378.2 90.4 L379.6 88.4 L381.0 87.8 L395.6 86.8 L400.2 85.6 L401.2 84.6 L403.6 75.8 L404.6 67.6 L403.8 66.2 L402.0 65.8 L383.8 66.0 L381.0 65.6 L379.8 63.8 L379.8 52.6 L379.4 51.6 L378.0 50.8Z M1104.4 16.4 L1098.4 17.2 L1089.8 19.6 L1068.8 24.2 L1065.6 25.2 L1064.4 27.4 L1063.0 104.0 L1062.0 119.6 L1062.0 127.6 L1063.4 136.6 L1064.6 141.2 L1066.2 144.6 L1069.0 149.2 L1073.6 154.4 L1076.8 157.0 L1082.4 160.0 L1092.8 163.6 L1094.8 163.6 L1098.0 161.2 L1108.8 149.8 L1115.8 143.8 L1118.6 140.4 L1118.6 139.6 L1117.6 138.2 L1106.2 132.2 L1101.2 129.0 L1099.8 127.2 L1099.8 115.2 L1100.8 107.2 L1101.4 90.0 L1103.4 64.0 L1103.8 50.0 L1105.0 39.4 L1105.4 26.0 L1106.0 21.6 L1105.8 17.8Z M1286.2 15.6 L1282.2 15.2 L1274.4 15.8 L1271.8 16.4 L1269.4 18.2 L1267.0 23.0 L1260.4 33.4 L1255.6 42.4 L1244.6 60.8 L1242.8 64.6 L1243.2 66.2 L1249.4 66.2 L1251.2 65.6 L1259.4 55.0 L1268.0 42.2 L1281.6 24.4 L1286.4 16.8Z M715.4 42.2 L710.6 35.8 L706.4 31.4 L698.8 25.6 L692.2 22.0 L682.4 17.6 L670.8 14.2 L659.0 12.2 L640.8 12.2 L629.6 13.2 L613.8 15.6 L610.2 16.8 L605.0 17.4 L593.2 20.4 L576.4 25.6 L565.0 30.2 L549.2 38.2 L545.8 40.6 L542.8 41.8 L532.0 48.6 L528.8 52.0 L515.2 73.4 L513.6 76.6 L513.8 78.0 L517.6 76.8 L524.4 73.0 L542.0 65.0 L564.6 57.0 L567.8 56.6 L577.4 53.8 L596.8 50.2 L613.2 49.2 L621.0 49.6 L622.0 50.4 L622.2 51.8 L619.8 56.2 L612.4 65.6 L605.4 76.2 L579.2 112.2 L547.4 151.8 L535.4 164.6 L533.2 165.6 L531.6 165.2 L513.2 156.8 L506.8 153.4 L502.4 151.8 L501.0 151.8 L498.6 154.0 L488.0 171.4 L485.6 176.2 L485.8 178.4 L497.2 188.6 L503.8 192.8 L510.0 194.8 L515.8 194.8 L518.8 194.2 L523.2 192.6 L530.8 187.8 L533.2 185.4 L535.4 184.0 L542.4 177.4 L552.6 166.6 L556.0 161.8 L558.8 159.2 L560.6 158.8 L567.6 163.2 L580.6 173.0 L587.0 177.2 L607.0 192.6 L614.4 197.6 L637.0 215.4 L638.4 215.4 L639.2 214.6 L642.2 208.4 L644.0 202.6 L645.8 199.6 L654.2 178.8 L654.4 174.8 L651.4 170.8 L645.4 165.0 L632.0 154.2 L619.0 145.0 L602.2 135.2 L601.0 133.4 L602.0 132.4 L623.6 128.4 L642.4 123.8 L663.0 116.4 L678.2 109.2 L692.4 100.8 L699.2 96.0 L707.8 87.8 L711.4 82.8 L715.4 76.0 L718.8 67.6 L720.0 63.2 L720.4 55.2 L718.6 48.8Z M672.2 70.6 L673.0 72.6 L672.8 74.2 L666.6 80.6 L651.8 93.2 L634.8 105.2 L627.6 109.4 L612.8 116.0 L596.2 120.6 L593.4 120.8 L592.2 120.0 L592.6 118.0 L596.0 113.6 L605.6 103.4 L612.6 95.0 L632.0 74.0 L644.8 61.0 L651.0 55.4 L652.2 54.8 L654.2 55.0 L661.4 59.0 L668.0 64.8Z M218.2 20.2 L215.0 17.4 L207.2 13.4 L203.4 12.0 L200.0 11.8 L197.6 12.0 L192.8 13.6 L176.8 21.0 L156.6 33.4 L139.0 47.2 L128.0 57.4 L116.8 69.8 L106.6 83.0 L102.2 87.8 L101.6 87.4 L101.4 86.4 L103.4 78.8 L123.0 20.6 L124.2 16.0 L123.8 14.0 L121.8 13.6 L117.6 14.4 L93.4 22.0 L90.6 23.4 L84.4 25.2 L78.8 27.8 L74.0 29.2 L32.0 45.4 L28.6 47.2 L27.0 49.8 L23.0 63.0 L21.6 66.2 L21.4 68.6 L22.2 69.6 L26.6 69.2 L39.4 65.2 L42.8 64.6 L50.0 62.0 L59.6 59.6 L66.4 57.2 L70.4 56.8 L71.4 57.6 L71.6 58.6 L65.0 71.0 L52.4 98.6 L51.4 102.2 L49.4 105.6 L39.4 131.8 L36.4 138.0 L31.6 152.8 L25.2 169.2 L17.4 194.0 L14.2 206.4 L13.4 210.8 L13.4 215.6 L14.4 216.4 L16.2 216.2 L67.4 198.4 L69.4 195.8 L76.0 178.6 L84.0 161.6 L88.0 154.8 L92.2 146.2 L99.0 136.0 L100.2 133.0 L105.4 124.4 L117.8 105.4 L128.6 89.8 L131.2 87.0 L132.0 85.2 L140.4 73.2 L156.4 52.4 L161.4 46.6 L162.4 46.6 L163.8 47.8 L169.6 56.8 L175.6 70.0 L179.4 82.0 L180.0 87.4 L181.2 90.6 L183.2 105.2 L183.6 124.4 L183.0 127.2 L181.6 128.4 L180.4 128.4 L171.4 126.2 L144.0 121.2 L137.0 121.2 L133.2 125.6 L116.4 148.4 L114.8 151.2 L114.8 152.4 L116.6 154.0 L126.4 157.6 L140.0 168.2 L148.6 172.0 L152.2 172.8 L162.2 173.0 L165.8 171.4 L179.0 160.4 L189.6 150.6 L204.0 136.0 L211.0 127.6 L216.2 120.2 L222.4 107.8 L227.6 91.6 L229.6 80.0 L229.8 74.4 L230.6 69.4 L230.8 57.4 L230.0 49.8 L227.4 38.6 L223.6 29.4Z";

export function BrandMark({ light = false }: { light?: boolean }) {
  return (
    <svg
      viewBox="0 0 1300 230"
      role="img"
      aria-label="Pet Royale'"
      className={`h-auto w-full max-w-[160px] shrink-0 ${
        light ? "text-[hsl(var(--accent))]" : "text-[hsl(var(--primary))]"
      }`}
    >
      <path fill="currentColor" fillRule="evenodd" d={WORDMARK_PATH} />
    </svg>
  );
}

/* Just the "P" of the wordmark, shown when the sidebar is collapsed. */
function BrandInitial() {
  return (
    <svg
      viewBox="6 4 226 222"
      role="img"
      aria-label="Pet Royale"
      className="mx-auto hidden h-8 w-auto text-[hsl(var(--accent))] lg:block"
    >
      <path fill="currentColor" fillRule="evenodd" d={WORDMARK_PATH} />
    </svg>
  );
}

interface NavChild {
  to: string;
  label: string;
  /* Match this path exactly, so /clients (Pets) is not also lit up on
     /clients/owners. */
  end?: boolean;
  adminOnly?: boolean;
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group: 0 | 1 | 2;
  end?: boolean;
  /* An entry with children is a dropdown. Its own `to` is only a key. */
  children?: NavChild[];
}

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, group: 0 },
  { to: "/appointments", label: "Appointments", icon: CalendarDays, group: 0 },
  {
    to: "/clients", label: "Patients", icon: PawPrint, group: 0,
    children: [
      { to: "/clients/owners", label: "Owners" },
      { to: "/clients", label: "Pets", end: true },
      { to: "/clients/records", label: "Medical Records" },
    ],
  },
  { to: "/billing", label: "Billing", icon: Receipt, group: 1 },
  { to: "/services", label: "Services", icon: Scissors, group: 1 },
  {
    to: "/inventory", label: "Inventory", icon: Package, group: 1,
    children: [
      { to: "/inventory/pet-essentials", label: "Pet Essentials", end: true },
      { to: "/inventory/supplies", label: "Supplies" },
    ],
  },
  { to: "/reports", label: "Reports", icon: BarChart3, group: 2 },
  {
    to: "/staff", label: "Staff", icon: Users, group: 2,
    children: [
      { to: "/staff", label: "Staff Accounts", end: true, adminOnly: true },
      { to: "/staff/attendance", label: "Attendance" },
    ],
  },
  { to: "/settings", label: "Settings", icon: Settings, group: 2 },
];
const GROUP_LABELS = ["Clinic", "Operations", "Management"];

function NavBadge({ count, compact }: { count: number; compact?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={`ml-auto inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[hsl(var(--accent))] px-1.5 text-[11px] font-bold leading-none text-[hsl(var(--accent-foreground))] ${compact ? "lg:absolute lg:right-1 lg:top-0.5 lg:ml-0 lg:h-4 lg:min-w-4 lg:px-1 lg:text-[10px]" : ""}`}
      aria-label={`${count} completed visit${count === 1 ? "" : "s"} not billed`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export default function AdminLayout({
  children, title, subtitle, eyebrow, actions,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  /* Which dropdowns the person opened or closed by hand. Until they do, a
     dropdown is open when one of its pages is the current page. */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const childActive = (c: NavChild) =>
    c.end ? pathname === c.to : pathname === c.to || pathname.startsWith(`${c.to}/`);
  const [profileOpen, setProfileOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [sidebarFocused, setSidebarFocused] = useState(false);
  const collapsed = !sidebarHovered && !sidebarFocused;
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);
  /* Name tooltip beside an icon. It is drawn outside the scrolling list so
     the list cannot clip it. Only on desktop, only when collapsed. */
  const showTip = (e: SyntheticEvent<HTMLElement>, label: string) => {
    if (!collapsed || !window.matchMedia("(min-width: 1024px)").matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2 });
  };

  const role = useAdminStore((s) => s.role);
  const notBilled = useNotBilledCount();
  const badgeFor = (to: string) => (to === "/billing" ? notBilled : 0);
  const fullName = useAdminStore((s) => s.fullName);
  const email = useAdminStore((s) => s.email);
  const logout = useAdminStore((s) => s.logout);
  const staffTitle = useAdminStore((s) => s.title);
  const avatarUrl = useAdminStore((s) => s.avatarUrl);
  const displayName = fullName ? (staffTitle ? `${staffTitle} ${fullName}` : fullName) : null;

  /* A regular staff member can only open Attendance, so for them that
     entry is a plain link instead of a dropdown with one item. */
  const navItems: NavItem[] = NAV.map((item) => {
    if (!item.children) return item;
    const kids = item.children.filter((c) => !c.adminOnly || role === "admin");
    return kids.length === 1
      ? { ...item, to: kids[0].to, label: kids[0].label, end: kids[0].end, children: undefined }
      : { ...item, children: kids };
  });

  const groups = [0, 1, 2]
    .map((g) => ({ label: GROUP_LABELS[g], items: navItems.filter((i) => i.group === g) }))
    .filter((g) => g.items.length > 0);

  useEffect(() => {
    if (!profileOpen) return;
    const onClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [profileOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileNavOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  const handleLogout = () => { logout(); navigate("/login", { replace: true }); };

  return (
    <>
      <ThemeStyles />
      <div className="workspace-shell flex h-screen overflow-hidden text-[hsl(var(--foreground))]">

        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}
        <aside
          aria-label="Main navigation"
          onMouseEnter={() => setSidebarHovered(true)}
          onMouseLeave={() => { setSidebarHovered(false); setTip(null); }}
          onFocusCapture={() => setSidebarFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSidebarFocused(false);
          }}
          className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col gap-4 border-r border-[hsl(var(--primary-foreground)/.16)] bg-[hsl(var(--primary))] px-3.5 py-4 text-[hsl(var(--primary-foreground))] transition-transform duration-200 lg:static lg:z-auto lg:shrink-0 lg:translate-x-0 lg:transition-[width] ${collapsed ? "lg:w-[64px]" : "lg:w-[208px]"} ${
            mobileNavOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-start justify-between gap-2 px-2">
            <div className="min-w-0 lg:flex-1">
              <div className={collapsed ? "lg:hidden" : ""}>
                <BrandMark light />
                <p className="mt-1 text-[10px] font-semibold tracking-[.02em] text-[hsl(var(--primary-foreground)/.82)]">
                  CLINIC AND VETERINARY SERVICES
                </p>
              </div>
              {collapsed && <BrandInitial />}
            </div>
            <button
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[hsl(var(--primary-foreground))] transition hover:bg-[hsl(var(--primary-foreground)/.1)] lg:hidden"
            >
              <X size={19} />
            </button>
          </div>

          <nav className="sidebar-scroll -mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-6 [mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]">
            {groups.map((group, gi) => (
              <div key={group.label}>
                {collapsed && gi > 0 && (
                  <div className="mx-3 my-2.5 hidden h-px bg-[hsl(var(--primary-foreground)/.14)] lg:block" />
                )}
                <p className="hidden">
                  {group.label}
                </p>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const { to, label, icon: Icon } = item;
                    const kids = item.children;
                    if (kids) {
                      const active = kids.some(childActive);
                      const open = openGroups[to] ?? active;
                      const panelId = `nav-group-${to.slice(1)}`;
                      return (
                        <div key={to}>
                          <button
                            type="button"
                            aria-label={label}
                            aria-expanded={open}
                            aria-controls={panelId}
                            onClick={() => setOpenGroups((s) => ({ ...s, [to]: !open }))}
                            onMouseEnter={(e) => showTip(e, label)}
                            onFocus={(e) => showTip(e, label)}
                            onMouseLeave={() => setTip(null)}
                            onBlur={() => setTip(null)}
                            className={`relative flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[14px] font-semibold text-[hsl(var(--primary-foreground)/.9)] transition hover:bg-[hsl(var(--primary-foreground)/.1)] [@media(min-height:760px)]:h-11 ${collapsed ? "lg:justify-center lg:gap-0 lg:px-0" : ""} ${
                              active && collapsed ? "lg:bg-[hsl(var(--primary-foreground)/.14)] lg:text-[hsl(var(--accent))]" : ""
                            }`}
                          >
                            <Icon size={18} aria-hidden="true" className="shrink-0" />
                            <span className={`min-w-0 flex-1 truncate ${collapsed ? "lg:hidden" : ""}`}>{label}</span>
                            <ChevronDown
                              size={16}
                              aria-hidden="true"
                              className={`shrink-0 transition-transform ${open ? "rotate-180" : ""} ${collapsed ? "lg:hidden" : ""}`}
                            />
                          </button>
                          {open && (
                            <div
                              id={panelId}
                              className={`ml-[21px] mt-0.5 flex flex-col gap-0.5 border-l border-[hsl(var(--primary-foreground)/.16)] pl-2 ${collapsed ? "lg:hidden" : ""}`}
                            >
                              {kids.map((c) => (
                                <NavLink
                                  key={c.to}
                                  to={c.to}
                                  end={c.end}
                                  onClick={() => setMobileNavOpen(false)}
                                  className={({ isActive }) =>
                                    `flex h-9 items-center rounded-lg px-3 text-[13.5px] font-semibold transition ${
                                      isActive
                                        ? "bg-[hsl(var(--primary-foreground)/.14)] text-[hsl(var(--accent))]"
                                        : "text-[hsl(var(--primary-foreground)/.9)] hover:bg-[hsl(var(--primary-foreground)/.1)]"
                                    }`
                                  }
                                >
                                  <span className="min-w-0 truncate">{c.label}</span>
                                </NavLink>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return (
                    <NavLink
                      key={to}
                      to={to}
                      end={item.end}
                      aria-label={label}
                      onMouseEnter={(e) => showTip(e, label)}
                      onFocus={(e) => showTip(e, label)}
                      onMouseLeave={() => setTip(null)}
                      onBlur={() => setTip(null)}
                      onClick={() => setMobileNavOpen(false)}
                      className={({ isActive }) =>
                        `relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-semibold transition [@media(min-height:760px)]:h-11 ${collapsed ? "lg:justify-center lg:gap-0 lg:px-0" : ""} ${
                          isActive
                            ? "bg-[hsl(var(--primary-foreground)/.14)] text-[hsl(var(--accent))]"
                            : "text-[hsl(var(--primary-foreground)/.9)] hover:bg-[hsl(var(--primary-foreground)/.1)]"
                        }`
                      }
                    >
                      <Icon size={18} aria-hidden="true" className="shrink-0" />
                      <span className={`min-w-0 truncate ${collapsed ? "lg:hidden" : ""}`}>{label}</span>
                      <NavBadge count={badgeFor(to)} compact={collapsed} />
                    </NavLink>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

        </aside>

        {/* Page Container */}
        <main className="workspace-scroll relative min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="workspace-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
          <div className="relative">

            <div className="sticky top-0 z-20 bg-[hsl(var(--primary))] shadow-[0_8px_20px_-16px_rgb(5_31_66/.55)]">
            <header className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3.5 px-5 py-4 text-[hsl(var(--primary-foreground))] sm:px-8 lg:px-10 md:py-1.5">
              <button
                onClick={() => setMobileNavOpen(true)}
                aria-expanded={mobileNavOpen}
                aria-label="Open navigation"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[hsl(var(--primary-foreground)/.3)] bg-transparent text-[hsl(var(--primary-foreground))] lg:hidden"
              >
                <Menu size={20} />
              </button>
              <div className="min-w-0">
                {title && (
                  <h1 className="truncate text-[14px] font-semibold leading-tight">
                    <span className="font-normal text-[hsl(var(--primary-foreground)/.72)]">Workspace › </span>{title}
                  </h1>
                )}
                {subtitle && <p className="text-[12px] text-[hsl(var(--primary-foreground)/.78)]">{subtitle}</p>}
              </div>
              <div className="flex-1" />
              <div className="flex shrink-0 items-center gap-2.5">
                {actions}
                <div className="flex h-10 items-center px-1.5 [&_button]:text-[hsl(var(--primary-foreground))]">
                  <NotificationBell />
                </div>
                <div ref={profileRef} className="relative">
                  {profileOpen && (
                    <div className="absolute right-0 top-full z-50 mt-2 w-[min(280px,calc(100vw-2rem))] overflow-hidden rounded-[18px] border-2 border-[hsl(var(--card-border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-[0_18px_50px_-24px_hsl(220_45%_18%/.5)]">
                      <div className="border-b border-[hsl(var(--border)/.7)] px-4 py-3">
                        <p className="truncate text-[14px] font-bold">{displayName || "—"}</p>
                        <p className="mt-0.5 truncate text-[12px] text-[hsl(var(--muted-foreground))]">{email}</p>
                      </div>
                      <div className="p-1.5">
                        <button
                          type="button"
                          onClick={() => { setProfileOpen(false); navigate("/account"); }}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[14px] font-semibold transition hover:bg-[hsl(var(--muted))]"
                        >
                          <User size={16} className="text-[hsl(var(--muted-foreground))]" />
                          Manage account
                        </button>
                        <button
                          onClick={() => { setProfileOpen(false); setShowChangePassword(true); }}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[14px] font-semibold transition hover:bg-[hsl(var(--muted))]"
                        >
                          <KeyRound size={16} className="text-[hsl(var(--muted-foreground))]" />
                          Change password
                        </button>
                        <div className="my-1.5 h-px bg-[hsl(var(--border)/.7)]" />
                        <button
                          onClick={() => { setProfileOpen(false); setShowLogoutConfirm(true); }}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[14px] font-semibold text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)/.1)]"
                        >
                          <Power size={16} />
                          Sign out
                        </button>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setProfileOpen((v) => !v)}
                    aria-expanded={profileOpen}
                    aria-label={`Account menu${displayName ? `, ${displayName}` : ""}`}
                    className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-[hsl(var(--primary-foreground)/.12)]"
                  >
                    <span className="h-10 w-10 shrink-0 rounded-full border-2 border-[hsl(var(--accent))] p-[3px]">
                      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-[hsl(var(--background))] text-[12px] font-bold text-[hsl(var(--primary))]">
                        {avatarUrl
                          ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                          : initials(fullName)}
                      </span>
                    </span>
                    <span className="hidden min-w-0 sm:block">
                      <span className="block max-w-[160px] truncate text-[13px] font-bold leading-[18px]">{displayName || "—"}</span>
                      <span className="block text-[12px] leading-4 text-[hsl(var(--primary-foreground)/.78)]">
                        {role === "admin" ? "Administrator" : "Staff"}
                      </span>
                    </span>
                    <ChevronUp
                      size={16}
                      className={`shrink-0 transition-transform ${profileOpen ? "" : "rotate-180"}`}
                    />
                  </button>
                </div>
              </div>
            </header>
            </div>

            {children}
          </div>
        </main>
      </div>

      {tip && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[60] hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-[hsl(var(--foreground))] px-2.5 py-1.5 text-[12px] font-semibold text-[hsl(var(--background))] shadow-lg lg:block"
          style={{ left: 84, top: tip.top }}
        >
          {tip.label}
        </span>
      )}

      <ChangePasswordDialog open={showChangePassword} onClose={() => setShowChangePassword(false)} />

      {showLogoutConfirm && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-5">
          <div className="workspace-card w-full max-w-[400px] rounded-[28px] p-7">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]">
                <Power size={20} />
              </div>
              <div className="min-w-0">
                <h2 className="display-face text-[24px] leading-none">
                  Sign out?
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
                  You&apos;ll need to sign back in to access the dashboard again.
                </p>
              </div>
            </div>

            <div className="mt-7 flex justify-end gap-2">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="h-11 rounded-xl border border-[hsl(var(--border))] px-4 text-sm font-bold transition hover:bg-[hsl(var(--muted))]"
              >
                Stay signed in
              </button>
              <button
                onClick={handleLogout}
                className="h-11 rounded-xl bg-[hsl(var(--destructive))] px-4 text-sm font-bold text-[hsl(var(--destructive-foreground))] transition hover:opacity-90"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
