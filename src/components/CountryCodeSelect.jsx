import React, { useEffect, useMemo, useRef, useState } from "react";
import { countryCodes } from "../utils/countryCodes";

const getCodeList = (codeStr) =>
  String(codeStr || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

const matchesQuery = (country, query) => {
  if (!query) return false;
  const q = query.toLowerCase();
  const nameMatch = country.name.toLowerCase().startsWith(q);
  const isoMatch = country.iso.toLowerCase().startsWith(q);

  const codeQuery = q.startsWith("+") ? q : `+${q}`;
  const codeMatch = getCodeList(country.code).some((code) =>
    code.toLowerCase().startsWith(codeQuery)
  );

  return nameMatch || isoMatch || codeMatch;
};

const isExactMatch = (country, value) => {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return false;

  if (country.name.toLowerCase() === v) return true;
  if (country.iso.toLowerCase() === v) return true;

  const codeValue = v.startsWith("+") ? v : `+${v}`;
  return getCodeList(country.code).some((code) => code.toLowerCase() === codeValue);
};

export default function CountryCodeSelect({ value, onChange, placeholder = "ISO (e.g., AUS)" }) {
  const [inputValue, setInputValue] = useState(value || "");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    setInputValue(value || "");
  }, [value]);

  useEffect(() => {
    const handleClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const results = useMemo(() => {
    const q = inputValue.trim();
    if (!q) return [];
    return countryCodes.filter((c) => matchesQuery(c, q));
  }, [inputValue]);

  const handleSelect = (country) => {
    onChange(country.iso);
    setInputValue(country.iso);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <input
        placeholder={placeholder}
        value={inputValue}
        onChange={(e) => {
          const next = e.target.value;
          setInputValue(next);
          onChange(next);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          const v = inputValue.trim();
          if (!v) return;
          const exact = countryCodes.find((c) => isExactMatch(c, v));
          if (!exact) {
            setInputValue("");
            onChange("");
          }
        }}
      />

      {open && inputValue.trim() && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 8,
            marginTop: 6,
            zIndex: 50,
            maxHeight: 220,
            overflowY: "auto",
            boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
          }}
        >
          {results.length === 0 ? (
            <div style={{ padding: "8px 10px", fontSize: 13, opacity: 0.7 }}>
              No matches
            </div>
          ) : (
            results.map((c) => (
              <button
                key={`${c.iso}-${c.code}`}
                type="button"
                onMouseDown={() => handleSelect(c)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {c.iso} {getCodeList(c.code)[0] || ""}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
