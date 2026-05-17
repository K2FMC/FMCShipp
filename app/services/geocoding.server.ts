interface GeocodeResult {
  lat: number;
  lng: number;
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const encoded = encodeURIComponent(address);
  const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "FMCShip/1.0 (killian@fmceu.com)" },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as Array<{
      lat: string;
      lon: string;
    }>;

    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}
