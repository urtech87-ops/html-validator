import type { ReportModel } from "./model";

/** JSON report: the report model, minus the logo bytes, with a schema version. */
export const REPORT_JSON_VERSION = 1;

export function renderJson(model: ReportModel): string {
  const { contents } = model;
  const { logo, ...branding } = model.branding;
  const documents = model.documents.map((d) => ({
    ...d,
    structure: d.structure
      ? {
          scope: d.structure.scope,
          counts: d.structure.counts,
          checks: contents.structure ? d.structure.checks : undefined,
          outline: contents.outline ? d.structure.outline : undefined,
          images: contents.images ? d.structure.images : undefined,
        }
      : undefined,
  }));
  return JSON.stringify(
    {
      schema: "markuplens-report",
      version: REPORT_JSON_VERSION,
      ...model,
      branding: { ...branding, hasLogo: !!logo },
      summary: contents.summary
        ? { counts: model.counts, averageScore: model.averageScore, siteScore: model.siteScore, passed: model.passed, failed: model.failed, notValidated: model.notValidated }
        : undefined,
      documents,
      structureRows: undefined,
    },
    null,
    2,
  );
}
