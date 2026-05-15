export interface MastObservationQuery {
  ra: number;
  dec: number;
  radiusDeg: number;
  missions: Array<"TESS" | "Kepler" | "K2">;
}

export interface MastObservation {
  obsid: string;
  obs_collection: string;
  target_name: string;
  t_min: number;
  t_max: number;
  filters?: string;
}

export interface MastProduct {
  obsid: string;
  productFilename: string;
  productType: string;
  dataURI: string;
  load: () => Promise<ArrayBuffer>;
}

const MAST_INVOKE = "https://mast.stsci.edu/api/v0/invoke";

async function mastInvoke<T>(request: object): Promise<T> {
  const response = await fetch(MAST_INVOKE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request: JSON.stringify(request) })
  });
  if (!response.ok) throw new Error(`MAST request failed: HTTP ${response.status}`);
  const json = await response.json();
  if (json.status === "ERROR") throw new Error(json.msg || "MAST service error");
  return json.data as T;
}

export async function queryMastObservations(query: MastObservationQuery): Promise<MastObservation[]> {
  const data = await mastInvoke<MastObservation[]>({
    service: "Mast.Caom.Cone",
    params: { ra: query.ra, dec: query.dec, radius: query.radiusDeg },
    format: "json",
    pagesize: 2000,
    removenullcolumns: true,
    timeout: 60
  });
  return data.filter(row => query.missions.includes(row.obs_collection as "TESS" | "Kepler" | "K2"));
}

export async function fetchMastLightCurveProducts(observations: MastObservation[]): Promise<MastProduct[]> {
  const products: MastProduct[] = [];
  for (const obs of observations.slice(0, 20)) {
    const rows = await mastInvoke<any[]>({
      service: "Mast.Caom.Products",
      params: { obsid: obs.obsid },
      format: "json",
      pagesize: 2000,
      timeout: 60
    });
    for (const row of rows) {
      const filename = String(row.productFilename || "").toLowerCase();
      if (!(filename.includes("lc") || filename.includes("lightcurve") || filename.endsWith(".fits"))) continue;
      products.push({
        obsid: obs.obsid,
        productFilename: row.productFilename,
        productType: row.productType,
        dataURI: row.dataURI,
        load: async () => {
          const url = `https://mast.stsci.edu/api/v0/download/file?uri=${encodeURIComponent(row.dataURI)}`;
          const response = await fetch(url);
          if (!response.ok) throw new Error(`MAST product download failed: ${row.productFilename}`);
          return response.arrayBuffer();
        }
      });
    }
  }
  return products;
}
