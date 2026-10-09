/** Static SQL only: legacy evidence resolves after a committed matching-basket activation. */
export function unresolvedPositionRebuildCondition(alias: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid recovery guard SQL alias");
  return `(${alias}.activated_run_id IS NULL OR NOT EXISTS(SELECT 1 FROM position_rebuild_runs activated
    WHERE activated.run_id=${alias}.activated_run_id AND activated.basket=${alias}.basket AND activated.status='activated'))`;
}
