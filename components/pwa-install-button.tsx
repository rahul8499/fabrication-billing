"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function PwaInstallButton() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [isAppleMobile, setIsAppleMobile] = useState(false);

  useEffect(() => {
    const appleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIsAppleMobile(appleMobile);
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setShowInstructions(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const install = async () => {
    if (!installPrompt) {
      setShowInstructions(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  };

  return <>
    <button className="button install-button small" onClick={() => void install()}>Install app</button>
    {showInstructions && <div className="install-overlay" onClick={() => setShowInstructions(false)}>
      <section className="panel install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={event => event.stopPropagation()}>
        <div className="section-heading"><div><h2 id="install-title">Install RS Fabrication</h2><p className="muted">Add this app to your home screen for quick access.</p></div><button className="text-button" onClick={() => setShowInstructions(false)} aria-label="Close">×</button></div>
        <div className="install-instructions">
          {isAppleMobile
            ? <p>In Safari, tap <b>Share</b>, choose <b>Add to Home Screen</b>, then tap <b>Add</b>.</p>
            : <p>Open your browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>}
        </div>
      </section>
    </div>}
  </>;
}
