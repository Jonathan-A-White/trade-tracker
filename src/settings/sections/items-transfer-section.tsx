import { useState, useRef } from "react";
import { exportItemsData, downloadAsFile } from "@/services/export-service";
import { validateItemsImportData, importItemsData } from "@/services/import-service";
import {
  AddedSummary,
  ConfirmModal,
  ErrorNote,
  OUTLINE_BUTTON_CLASS,
  SectionCard,
  SectionNote,
  SuccessNote,
} from "../parts";

export function ItemsTransferSection() {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingData, setPendingData] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    const json = await exportItemsData();
    const timestamp = new Date().toISOString().split("T")[0];
    downloadAsFile(json, `tradetracker-items-${timestamp}.json`, "application/json");
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setResult(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        const parsed = JSON.parse(text);
        const validation = validateItemsImportData(parsed);
        if (!validation.valid) {
          setError(`Invalid file: ${validation.errors.join(", ")}`);
          return;
        }
        setPendingData(text);
        setShowConfirm(true);
      } catch {
        setError("Could not parse file. Make sure it is a valid JSON items export.");
      }
    };
    reader.readAsText(file);
  }

  async function handleConfirmImport() {
    if (!pendingData) return;
    setImporting(true);
    setShowConfirm(false);
    try {
      const imported = await importItemsData(pendingData);
      setResult(imported);
      setPendingData(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleCancelImport() {
    setShowConfirm(false);
    setPendingData(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <>
      <SectionCard title="Export / Import Items">
        <SectionNote>
          Export all items as a JSON file, or import items from a previously exported file.
          Importing will add new items without overwriting existing ones.
        </SectionNote>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleExport}
            className={`flex-1 ${OUTLINE_BUTTON_CLASS}`}
          >
            Export Items
          </button>
          <label className={`flex-1 text-center ${OUTLINE_BUTTON_CLASS}`}>
            {importing ? "Importing..." : "Import Items"}
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              disabled={importing}
              className="hidden"
            />
          </label>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        {result && (
          <SuccessNote>
            <AddedSummary
              added={result.added}
              skipped={result.skipped}
              noun="item"
              skippedTail="already in library"
            />
          </SuccessNote>
        )}
      </SectionCard>

      {showConfirm && (
        <ConfirmModal
          title="Import Items?"
          message="New items will be added to your library. Existing items with the same ID will be skipped."
          confirmLabel="Import"
          confirmClass="bg-blue-600 hover:bg-blue-700"
          onCancel={handleCancelImport}
          onConfirm={handleConfirmImport}
        />
      )}
    </>
  );
}
