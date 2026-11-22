
import json
import urllib.parse
import urllib.request

from datetime import datetime, timezone


WEATHER_URL = "https://api.open-meteo.com/v1/forecast"


def get_weather(latitude, longitude, checkpoint_time):
    """Fetch hourly weather forecast for a route checkpoint."""

    params = urllib.parse.urlencode({
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "precipitation,snowfall,wind_speed_10m",
        "forecast_days": 3,
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": "UTC",
    })

    request = urllib.request.Request(
        f"{WEATHER_URL}?{params}",
        headers={
            "User-Agent": "SpotterAI-TruckRouting/1.0",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))

    except Exception as error:
        raise RuntimeError(
            f"Weather API request failed: {error}"
        )

    if "hourly" not in data:
        raise RuntimeError("Weather API returned no hourly forecast.")

    hourly = data["hourly"]

    required_fields = [
        "time",
        "precipitation",
        "snowfall",
        "wind_speed_10m",
    ]

    for field in required_fields:
        if field not in hourly or not hourly[field]:
            raise RuntimeError(
                f"Missing weather forecast field: {field}"
            )

    # Convert checkpoint time to UTC.
    if checkpoint_time.tzinfo is None:
        checkpoint_time = checkpoint_time.replace(
            tzinfo=timezone.utc
        )

    target = checkpoint_time.astimezone(
        timezone.utc
    ).replace(tzinfo=None)

    forecast_times = [
        datetime.fromisoformat(value)
        for value in hourly["time"]
    ]

    # Find the nearest hourly forecast.
    index = min(
        range(len(forecast_times)),
        key=lambda i: abs(
            (forecast_times[i] - target).total_seconds()
        ),
    )

    difference = abs(
        (forecast_times[index] - target).total_seconds()
    )

    if difference > 3600:
        raise RuntimeError(
            "No suitable hourly forecast for this checkpoint time."
        )

    wind = hourly["wind_speed_10m"][index] or 0
    rain = hourly["precipitation"][index] or 0

    # Open-Meteo snowfall is returned in centimetres by default.
    snow_cm = hourly["snowfall"][index] or 0
    snow_inches = snow_cm / 2.54

    return {
        "time": hourly["time"][index],
        "wind_mph": round(float(wind), 2),
        "rain_inches": round(float(rain), 3),
        "snow_inches": round(float(snow_inches), 3),
    }


def classify_weather(weather, load_weight):
    """Calculate weather risk using truck safety thresholds."""

    wind = float(weather.get("wind_mph", 0))
    rain = float(weather.get("rain_inches", 0))
    snow = float(weather.get("snow_inches", 0))

    # Wind risk
    if wind >= 55:
        wind_risk = "No Travel"
    elif wind >= 45:
        wind_risk = "Severe"
    elif wind >= 35:
        wind_risk = "High"
    elif wind >= 25:
        wind_risk = "Moderate"
    else:
        wind_risk = "Low"

    # Rain risk
    if rain > 1.0:
        rain_risk = "No Travel"
    elif rain >= 0.50:
        rain_risk = "Severe"
    elif rain >= 0.25:
        rain_risk = "High"
    elif rain >= 0.10:
        rain_risk = "Moderate"
    else:
        rain_risk = "Low"

    # Snow risk
    if snow > 3.0:
        snow_risk = "No Travel"
    elif snow >= 2.0:
        snow_risk = "Severe"
    elif snow >= 1.0:
        snow_risk = "High"
    elif snow >= 0.5:
        snow_risk = "Moderate"
    else:
        snow_risk = "Low"

    risks = [
        wind_risk,
        rain_risk,
        snow_risk,
    ]

    # Truck load safety adjustments
    if 45 <= wind < 55 and load_weight > 30000:
        risks.append("No Travel")

    if 35 <= wind < 45 and load_weight > 40000:
        risks.append("Severe")

    ranking = {
        "Low": 0,
        "Moderate": 1,
        "High": 2,
        "Severe": 3,
        "No Travel": 4,
    }

    overall_risk = max(
        risks,
        key=lambda risk: ranking[risk]
    )

    return {
        "level": overall_risk,
        "wind_risk": wind_risk,
        "rain_risk": rain_risk,
        "snow_risk": snow_risk,
        "wind_mph": wind,
        "rain_inches": rain,
        "snow_inches": round(snow, 3),
    }
