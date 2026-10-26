import "./index.css";
import { createRoot } from "react-dom/client";
import { BarberBento, type BarberBentoProps } from "@/components/ui/barber-bento";

/** Monta a página inicial em um elemento do painel e devolve a função de desmontagem. */
export function mount(el: HTMLElement, props: BarberBentoProps) {
  const root = createRoot(el);
  root.render(<BarberBento {...props} />);
  return () => root.unmount();
}
