(() => {
  if (window.ResonantOSControlOverlay) return;
  const controlPhaseDetails = {
    active: { icon: "(( ))", label: "Working..." },
    blocked: { icon: "!!", label: "Blocked" },
    clicking: { icon: "*", label: "Clicking..." },
    done: { icon: "ok", label: "Done" },
    reading: { icon: "doc", label: "Reading page..." },
    returning: { icon: "<-", label: "Returning control..." },
    screenshot: { icon: "cam", label: "Taking screenshot..." },
    typing: { icon: "kbd", label: "Typing..." },
    verifying: { icon: "chk", label: "Verifying..." },
    waiting: { icon: "...", label: "Waiting..." },
    working: { icon: "(( ))", label: "Working..." }
  };

  const controlPhaseForLabel = (state, label = "") => {
    const normalized = String(label ?? "").toLowerCase();
    if (state === "blocked") return "blocked";
    if (state === "done") return "done";
    if (/read|observ|context|scan|summar/i.test(normalized)) return "reading";
    if (/click|press|tap|select/i.test(normalized)) return "clicking";
    if (/typ|writ|enter|input/i.test(normalized)) return "typing";
    if (/screenshot|capture/i.test(normalized)) return "screenshot";
    if (/verif|check/i.test(normalized)) return "verifying";
    if (/wait/i.test(normalized)) return "waiting";
    return "working";
  };

  const controlLabelForPhase = (phase, label = "") => {
    const detail = controlPhaseDetails[phase] ?? controlPhaseDetails.working;
    const trimmed = String(label ?? "").trim();
    if (!trimmed || /^augmentor (is )?operating/i.test(trimmed)) {
      return detail.label;
    }
    return trimmed;
  };

  const createControlOverlayController = ({
    chromeRuntime,
    controlBubbleClass,
    controlOverlayId,
    controlStatusTextClass,
    controlStopButtonClass,
    controlToastId,
    isTopWindow,
  }) => {
    const ensureControlOverlay = () => {
      if (!document.getElementById("resonantos-control-overlay-styles")) {
        const style = document.createElement("style");
        style.id = "resonantos-control-overlay-styles";
        style.textContent = `
          #${controlOverlayId}, #${controlToastId} { all: initial; color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; z-index: 2147483646; pointer-events: none; }
          #${controlOverlayId} { position: fixed; inset: 0; display: none; border: 4px solid rgba(34,184,207,.98); box-shadow: inset 0 0 92px rgba(34,184,207,.34), inset 0 0 180px rgba(34,184,207,.18), 0 0 72px rgba(34,184,207,.34); background:
            linear-gradient(90deg, rgba(34,184,207,.38), transparent 22%, transparent 78%, rgba(34,184,207,.38)),
            linear-gradient(0deg, rgba(34,184,207,.32), transparent 24%, transparent 76%, rgba(34,184,207,.32)),
            repeating-linear-gradient(90deg, rgba(34,184,207,.14) 0 3px, transparent 3px 13px),
            repeating-linear-gradient(0deg, rgba(34,184,207,.10) 0 2px, transparent 2px 15px); opacity: .96; }
          #${controlOverlayId}[data-state="active"], #${controlOverlayId}[data-session="active"] { display:block; animation: ros-control-pixel 3.4s linear infinite, ros-control-fluid 5.8s ease-in-out infinite alternate; }
          #${controlOverlayId}[data-state="done"] { display:block; border-color: rgba(125,230,255,.72); animation: ros-control-fade .8s ease-out forwards; }
          #${controlOverlayId}[data-state="blocked"] { display:block; border-color: rgba(255,121,91,.9); box-shadow: inset 0 0 46px rgba(255,121,91,.16), 0 0 40px rgba(255,121,91,.2); animation: ros-control-fade 1.1s ease-out forwards; }
          #${controlOverlayId}::before, #${controlOverlayId}::after { content:""; position:absolute; left:-35%; right:-35%; height:76px; background: linear-gradient(90deg, transparent, rgba(34,184,207,.22), rgba(34,184,207,.78), rgba(34,184,207,.22), transparent); }
          #${controlOverlayId}::before { top:0; box-shadow: 0 32px 66px rgba(34,184,207,.18); }
          #${controlOverlayId}::after { bottom:0; box-shadow: 0 -32px 66px rgba(34,184,207,.18); }
          #${controlOverlayId} .ros-control-left, #${controlOverlayId} .ros-control-right { position:absolute; top:-25%; bottom:-25%; width:92px; background: linear-gradient(180deg, transparent, rgba(34,184,207,.70), transparent); opacity:.86; }
          #${controlOverlayId} .ros-control-left { left:0; }
          #${controlOverlayId} .ros-control-right { right:0; }
          #${controlOverlayId}[data-session="active"] .ros-control-left { animation: ros-control-side 1.9s linear infinite; }
          #${controlOverlayId}[data-session="active"] .ros-control-right { animation: ros-control-side 1.9s linear infinite reverse; }
          #${controlOverlayId}[data-session="active"]::before { animation: ros-control-edge 1.6s linear infinite; }
          #${controlOverlayId}[data-session="active"]::after { animation: ros-control-edge 1.6s linear infinite reverse; }
          #${controlToastId} { position: fixed; left: 50%; bottom: 20px; display:none; grid-template-columns:auto minmax(0, 1fr) auto; align-items:center; gap:9px; width: min(390px, calc(100vw - 32px)); transform: translateX(-50%); border: 1px solid rgba(34,184,207,.34); border-radius: 14px; background: linear-gradient(135deg, rgba(7,55,44,.86), rgba(4,24,20,.92)); color:#8fe9f7; box-shadow: 0 18px 58px rgba(0,0,0,.38), 0 0 34px rgba(34,184,207,.24); font: 800 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 8px 8px 8px 12px; text-align:left; backdrop-filter: blur(14px); pointer-events:auto; }
          #${controlToastId}[data-session="active"], #${controlToastId}[data-state="active"], #${controlToastId}[data-state="done"], #${controlToastId}[data-state="blocked"] { display:grid; }
          #${controlToastId}[data-state="blocked"] { border-color: rgba(255,121,91,.5); color:#ffd9d1; }
          #${controlToastId} .${controlStatusTextClass} { all: initial; min-width:0; overflow:hidden; color:inherit; font: 800 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
          #${controlToastId} .ros-control-phase-icon { all: initial; color:inherit; font: 900 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; opacity:.9; }
          #${controlToastId} .${controlStopButtonClass} { all: initial; box-sizing:border-box; display:grid; place-items:center; width:34px; height:28px; border-left:1px solid rgba(142,244,211,.18); border-radius: 10px; color:#baffea; cursor:pointer; font: 900 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; pointer-events:auto; }
          #${controlToastId} .${controlStopButtonClass}::before { content:""; width:12px; height:12px; border-radius:4px; background:#7df3dc; box-shadow:0 0 14px rgba(125,243,220,.62); }
          #${controlToastId} .${controlStopButtonClass}:hover { background:rgba(255,255,255,.08); }
          .resonantos-control-target { outline: 2px solid rgba(34,184,207,.9) !important; outline-offset: 4px !important; box-shadow: 0 0 0 6px rgba(34,184,207,.16), 0 0 34px rgba(34,184,207,.38) !important; }
          .${controlBubbleClass} { all: initial; position: fixed; max-width: min(360px, calc(100vw - 32px)); z-index: 2147483647; pointer-events: none; transform: translate(-50%, calc(-100% - 14px)); border: 1px solid rgba(34,184,207,.5); border-radius: 999px; background: rgba(3,14,9,.94); color:#e6fbff; box-shadow: 0 16px 42px rgba(0,0,0,.34), 0 0 34px rgba(34,184,207,.28); font: 900 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 9px 12px; text-align:center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; animation: ros-control-bubble 2.1s ease-out forwards; }
          .${controlBubbleClass}[data-state="blocked"] { border-color: rgba(255,121,91,.68); color:#ffd9d1; box-shadow: 0 16px 42px rgba(0,0,0,.34), 0 0 34px rgba(255,121,91,.24); }
          @keyframes ros-control-pixel { 0% { background-position: 0 0, 0 0, 0 0, 0 0; } 100% { background-position: 44px 0, -32px 20px, 0 52px, 44px 0; } }
          @keyframes ros-control-fluid { 0% { box-shadow: inset 0 0 82px rgba(34,184,207,.26), inset 0 0 170px rgba(34,184,207,.16), 0 0 58px rgba(34,184,207,.28); } 100% { box-shadow: inset 0 0 120px rgba(34,184,207,.38), inset 0 0 230px rgba(34,184,207,.22), 0 0 82px rgba(34,184,207,.38); } }
          @keyframes ros-control-edge { 0% { transform: translateX(-18%); opacity:.28; } 45% { opacity:1; } 100% { transform: translateX(18%); opacity:.28; } }
          @keyframes ros-control-side { 0% { transform: translateY(-18%); opacity:.32; } 45% { opacity:1; } 100% { transform: translateY(18%); opacity:.32; } }
          @keyframes ros-control-fade { 0% { opacity:.9; } 100% { opacity:0; } }
          @keyframes ros-control-bubble { 0% { opacity:0; transform: translate(-50%, calc(-100% - 4px)) scale(.96); } 16% { opacity:1; transform: translate(-50%, calc(-100% - 14px)) scale(1); } 78% { opacity:1; } 100% { opacity:0; transform: translate(-50%, calc(-100% - 24px)) scale(.98); } }
        `;
        document.documentElement.append(style);
      }
      let overlay = document.getElementById(controlOverlayId);
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = controlOverlayId;
        overlay.innerHTML = `<span class="ros-control-left"></span><span class="ros-control-right"></span>`;
        document.documentElement.append(overlay);
      }
      let toast = document.getElementById(controlToastId);
      if (!toast) {
        toast = document.createElement("div");
        toast.id = controlToastId;
        toast.innerHTML = `<span class="ros-control-phase-icon"></span><span class="${controlStatusTextClass}"></span><button class="${controlStopButtonClass}" type="button" title="Stop Augmentor control" aria-label="Stop Augmentor control"></button>`;
        toast.querySelector(`.${controlStopButtonClass}`).addEventListener("click", () => {
          toast.querySelector(`.${controlStatusTextClass}`).textContent = "Stopping...";
          chromeRuntime?.sendMessage?.({
            channel: "resonantos.browser_first.side_panel",
            type: "cancel_control_run",
            reason: "Stopped from page overlay"
          }).catch(() => undefined);
        });
        document.documentElement.append(toast);
      }
      return { overlay, toast };
    };

    const setControlToast = (toast, { state = "active", label = "", phase = "" } = {}) => {
      const resolvedPhase = phase || controlPhaseForLabel(state, label);
      const detail = controlPhaseDetails[resolvedPhase] ?? controlPhaseDetails.working;
      toast.dataset.phase = resolvedPhase;
      toast.dataset.state = state;
      toast.querySelector(".ros-control-phase-icon").textContent = detail.icon;
      toast.querySelector(`.${controlStatusTextClass}`).textContent = controlLabelForPhase(resolvedPhase, label);
    };

    const showControlActionBubble = (target, label, state = "active") => {
      if (!target?.getBoundingClientRect) return;
      const rect = target.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      document.querySelectorAll(`.${controlBubbleClass}`).forEach((bubble) => bubble.remove());
      const bubble = document.createElement("div");
      bubble.className = controlBubbleClass;
      bubble.dataset.state = state;
      bubble.textContent = label;
      const centerX = Math.max(18, Math.min(window.innerWidth - 18, rect.left + rect.width / 2));
      const topY = Math.max(46, rect.top);
      bubble.style.left = `${Math.round(centerX)}px`;
      bubble.style.top = `${Math.round(topY)}px`;
      document.documentElement.append(bubble);
      window.setTimeout(() => bubble.remove(), 2200);
    };

    const pulseControlOverlay = ({ state = "active", label = "Augmentor is operating this page", phase = "", target = null } = {}) => {
      if (!isTopWindow()) {
        if (target?.classList) {
          ensureControlOverlay();
          target.classList.add("resonantos-control-target");
          showControlActionBubble(target, label, state);
          window.setTimeout(() => target.classList.remove("resonantos-control-target"), 1500);
        }
        return;
      }
      const { overlay, toast } = ensureControlOverlay();
      const now = Date.now();
      if (!target && state === "active" && Number(toast.dataset.lockedUntil || 0) > now) {
        return;
      }
      const sessionActive = overlay.dataset.session === "active";
      overlay.dataset.state = sessionActive && state !== "blocked" ? "active" : state;
      setControlToast(toast, { state, label, phase });
      document.querySelectorAll(".resonantos-control-target").forEach((element) => element.classList.remove("resonantos-control-target"));
      if (target?.classList) {
        target.classList.add("resonantos-control-target");
        showControlActionBubble(target, label, state);
        toast.dataset.lockedUntil = String(now + 1800);
        window.setTimeout(() => target.classList.remove("resonantos-control-target"), 1500);
      }
      if (state !== "active") {
        window.setTimeout(() => {
          if (overlay.dataset.state === state || overlay.dataset.session === "active") overlay.dataset.state = overlay.dataset.session === "active" ? "active" : "";
          if (toast.dataset.state === state) {
            if (toast.dataset.session === "active") {
              toast.dataset.state = "active";
              setControlToast(toast, {
                state: "active",
                label: toast.dataset.sessionLabel || "Augmentor is operating this page",
                phase: toast.dataset.sessionPhase || "working"
              });
            } else {
              toast.dataset.state = "";
            }
          }
        }, 1300);
      }
    };

    const setControlSessionOverlay = ({ active = false, label = "Augmentor is operating this page", phase = "working" } = {}) => {
      if (!isTopWindow()) {
        return { ok: true, active };
      }
      const { overlay, toast } = ensureControlOverlay();
      window.clearTimeout(globalThis.__resonantosControlStopTimer);
      if (active) {
        overlay.dataset.session = "active";
        overlay.dataset.state = "active";
        toast.dataset.session = "active";
        toast.dataset.sessionLabel = label;
        toast.dataset.sessionPhase = phase || controlPhaseForLabel("active", label);
        setControlToast(toast, { state: "active", label, phase: toast.dataset.sessionPhase });
        return { ok: true, active };
      }
      setControlToast(toast, { state: "active", label: "Returning control to human...", phase: "returning" });
      globalThis.__resonantosControlStopTimer = window.setTimeout(() => {
        overlay.dataset.session = "";
        overlay.dataset.state = "";
        toast.dataset.session = "";
        toast.dataset.sessionLabel = "";
        toast.dataset.sessionPhase = "";
        toast.dataset.state = "";
        toast.dataset.lockedUntil = "0";
        toast.querySelector(".ros-control-phase-icon").textContent = "";
        toast.querySelector(`.${controlStatusTextClass}`).textContent = "";
        document.querySelectorAll(".resonantos-control-target").forEach((element) => element.classList.remove("resonantos-control-target"));
      }, 6500);
      return { ok: true, active };
    };

    return {
      pulseControlOverlay,
      setControlSessionOverlay,
    };
  };

  window.ResonantOSControlOverlay = {
    controlPhaseDetails,
    createControlOverlayController,
  };
})();
