import { useEffect } from "react";
import { DockLayout } from "./components/DockLayout";
import { useExoStore } from "./state/useExoStore";
import { initializeGoldTargets } from "./data/dataOrchestrator";

export default function App() {
  const setTargets = useExoStore(s => s.setTargets);
  const setSelectedIndex = useExoStore(s => s.setSelectedIndex);
  const pushConsole = useExoStore(s => s.pushConsole);

  useEffect(() => {
    initializeGoldTargets()
      .then(targets => {
        setTargets(targets);
        setSelectedIndex(0);
        pushConsole("ok", `Loaded ${targets.length} ExoIntel targets`);
      })
      .catch(err => pushConsole("bad", `Target initialization failed: ${String(err)}`));
  }, [setTargets, setSelectedIndex, pushConsole]);

  return <DockLayout />;
}
