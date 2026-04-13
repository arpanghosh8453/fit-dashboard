import { useState, useRef, useEffect } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  selected: Date | undefined;
  onSelect: (date: Date | undefined) => void;
  anchorRef: React.RefObject<HTMLElement>;
};

function formatInputDate(date?: Date): string {
  if (!date) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function parseInputDate(value: string): Date | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const candidate = new Date(year, month - 1, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }
  return candidate;
}

export function DatePickerPopover({ isOpen, onClose, selected, onSelect, anchorRef }: Props) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setInputValue(formatInputDate(selected));
    setInputError(null);
  }, [isOpen, selected]);

  useEffect(() => {
    if (!isOpen) return;

    function updatePosition() {
      const pop = popoverRef.current;
      const anchor = anchorRef.current;
      if (!pop || !anchor) return;

      const sidebar = anchor.closest(".sidebar") as HTMLElement | null;
      if (!sidebar) {
        setOffsetX(0);
        return;
      }

      const popRect = pop.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      const gutter = 8;

      let shift = 0;
      if (popRect.right > sidebarRect.right - gutter) {
        shift -= popRect.right - (sidebarRect.right - gutter);
      }
      if (popRect.left + shift < sidebarRect.left + gutter) {
        shift += (sidebarRect.left + gutter) - (popRect.left + shift);
      }
      setOffsetX(Math.round(shift));
    }

    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen, anchorRef, inputValue]);

  function commitInputDate(closeOnSuccess: boolean) {
    const parsed = parseInputDate(inputValue);
    if (parsed === undefined) {
      onSelect(undefined);
      setInputError(null);
      if (closeOnSuccess) onClose();
      return;
    }
    if (parsed === null) {
      setInputError("Use DD-MM-YYYY");
      return;
    }
    onSelect(parsed);
    setInputValue(formatInputDate(parsed));
    setInputError(null);
    if (closeOnSuccess) onClose();
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="datepicker-popover"
      style={{ transform: `translateX(${offsetX}px)` }}
      onClick={(e) => e.stopPropagation()}
    >
      <DayPicker
        mode="single"
        selected={selected}
        onSelect={(d) => { onSelect(d); setInputValue(formatInputDate(d)); setInputError(null); onClose(); }}
      />
      <div style={{ marginTop: "8px" }}>
        <input
          type="text"
          placeholder="DD-MM-YYYY"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (inputError) setInputError(null);
          }}
          onBlur={() => commitInputDate(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitInputDate(true);
            }
          }}
          style={{ width: "100%" }}
        />
        {inputError ? (
          <div className="small" style={{ marginTop: "6px", color: "var(--danger-color, #ef4444)" }}>
            {inputError}
          </div>
        ) : null}
      </div>
      <div style={{ marginTop: "10px", textAlign: "right" }}>
        <button className="btn-compact" style={{ width: "100%", justifyContent: "center" }} onClick={() => { onSelect(undefined); onClose(); }}>
          Clear
        </button>
      </div>
    </div>
  );
}
