import { useCallback, useMemo, useReducer } from "react";
import type { DictionaryRow } from "./dictionaryViewModel";

export interface SelectionState {
  selected: ReadonlySet<string>;
  // The last key ticked on its own; Shift-click selects from here.
  anchor: string | null;
}

export type SelectionAction =
  | { type: "toggle"; key: string }
  | { type: "range"; key: string; orderedKeys: string[] }
  | { type: "selectAll"; orderedKeys: string[] }
  | { type: "clear" };

const EMPTY_SELECTION: SelectionState = { selected: new Set(), anchor: null };

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case "toggle": {
      const selected = new Set(state.selected);
      if (selected.has(action.key)) selected.delete(action.key);
      else selected.add(action.key);
      return { selected, anchor: action.key };
    }
    case "range": {
      const end = action.orderedKeys.indexOf(action.key);
      if (end === -1) return state;
      const start = state.anchor === null ? -1 : action.orderedKeys.indexOf(state.anchor);
      const selected = new Set(state.selected);
      // With no anchor in the list there is no range yet: the click starts one.
      if (start === -1) {
        selected.add(action.key);
        return { selected, anchor: action.key };
      }
      const [from, to] = start <= end ? [start, end] : [end, start];
      for (const key of action.orderedKeys.slice(from, to + 1)) selected.add(key);
      return { selected, anchor: state.anchor };
    }
    case "selectAll":
      return { selected: new Set(action.orderedKeys), anchor: state.anchor };
    case "clear":
      return state.selected.size === 0 && state.anchor === null ? state : EMPTY_SELECTION;
  }
}

export interface DictionarySelection {
  // Selected rows still in the list, in list order. Keys of rows that left it
  // (filtered by search, moved, deleted) stay in state but never count.
  selectedRows: DictionaryRow[];
  isSelected: (key: string) => boolean;
  toggle: (key: string, extend: boolean) => void;
  selectAll: () => void;
  clear: () => void;
}

export function useDictionarySelection(rows: DictionaryRow[]): DictionarySelection {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);
  const orderedKeys = useMemo(() => rows.map((row) => row.key), [rows]);
  const selectedRows = useMemo(
    () => rows.filter((row) => state.selected.has(row.key)),
    [rows, state.selected]
  );
  const visible = useMemo(() => new Set(selectedRows.map((row) => row.key)), [selectedRows]);

  const toggle = useCallback(
    (key: string, extend: boolean): void =>
      dispatch(extend ? { type: "range", key, orderedKeys } : { type: "toggle", key }),
    [orderedKeys]
  );
  const selectAll = useCallback(
    (): void => dispatch({ type: "selectAll", orderedKeys }),
    [orderedKeys]
  );
  const clear = useCallback((): void => dispatch({ type: "clear" }), []);
  const isSelected = useCallback((key: string): boolean => visible.has(key), [visible]);

  return { selectedRows, isSelected, toggle, selectAll, clear };
}
