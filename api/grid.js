export default async function handler(request, response) {
  const { zone, type = "latest" } = request.query;

  if (!zone || !["latest", "history"].includes(type)) {
    return response.status(400).json({ error: "Invalid request" });
  }

  const upstream = await fetch(
    `https://api.electricitymap.org/v3/carbon-intensity/${type}?zone=${encodeURIComponent(zone)}`,
    {
      headers: {
        "auth-token": process.env.ELECTRICITY_MAPS_API_KEY,
        Accept: "application/json",
      },
    }
  );

  const data = await upstream.json();
  return response.status(upstream.status).json(data);
}