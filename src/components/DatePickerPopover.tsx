import { useState, useRef, useEffect } from "react";
import { DayPicker, DateRange } from "react-day-picker";
import "react-day-picker/dist/style.css";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  selected: Date | undefined;
  onSelect: (date: Date | undefined) => void;
  anchorRef: React.RefObject<HTMLElement>;
};

export function DatePickerPopover({ isOpen, onClose, selected, onSelect, anchorRef }: Props) {
  const popoverRef = useRef<HTMLDivElement>(null);

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
      onClick={(e) => e.stopPropagation()}
    >
      <DayPicker
        mode="single"
        selected={selected}
        onSelect={(d) => { onSelect(d); onClose(); }}
      />
      <div style={{ marginTop: "10px", textAlign: "right" }}>
        <button className="btn-compact" style={{ width: "100%", justifyContent: "center" }} onClick={() => { onSelect(undefined); onClose(); }}>
          Clear
        </button>
      </div>
    </div>
  );
}
