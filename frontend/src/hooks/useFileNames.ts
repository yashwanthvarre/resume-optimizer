import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getFileNames } from "../api/client";
import { useApp } from "../store/app";
import { acceptedEdits } from "../store/derive";

/** What Download will call the files (server-built, so the preview and the real name always agree). */
export function useFileNames() {
  const resume = useApp((s) => s.resume), analysis = useApp((s) => s.analysis), selected = useApp((s) => s.selected), edits = useApp((s) => s.edits);
  const cfg = useApp((s) => s.cfg);
  const accepted = useMemo(() => acceptedEdits({ resume, analysis, selected, edits }), [resume, analysis, selected, edits]);
  return useQuery({
    queryKey: ["fileNames", resume?.session_id, accepted, cfg?.name_override],
    queryFn: () => getFileNames(resume!.session_id, accepted),
    enabled: !!resume && !!analysis,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  }).data;
}
