
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import Trip
from .serializers import TripSerializer
from .services import (
    get_route_options,
    enrich_routes_with_weather,
)


@api_view(["GET"])
def health_check(request):
    return Response({
        "success": True,
        "message": "Spotter AI Backend is running!",
        "application": "Spotter AI",
        "status": "Healthy",
    })


@api_view(["GET", "POST"])
def trip_list(request):

    if request.method == "GET":
        trips = Trip.objects.all().order_by("-created_at")
        serializer = TripSerializer(trips, many=True)

        return Response({
            "success": True,
            "count": trips.count(),
            "trips": serializer.data,
        })

    serializer = TripSerializer(data=request.data)

    if not serializer.is_valid():
        return Response({
            "success": False,
            "errors": serializer.errors,
        }, status=status.HTTP_400_BAD_REQUEST)

    trip = serializer.save()

    try:
        route_data = get_route_options(
            trip.origin,
            trip.destination,
        )

        route_data = enrich_routes_with_weather(
            route_data=route_data,
            departure_time=trip.departure_time,
            load_weight=trip.load_weight,
            checkpoint_interval=trip.checkpoint_interval,
        )

        return Response({
            "success": True,
            "message": "Trip, routes and weather analysis generated!",
            "trip": TripSerializer(trip).data,
            "route_data": route_data,
        }, status=status.HTTP_201_CREATED)

    except Exception as error:
        return Response({
            "success": True,
            "message": "Trip saved, but route or weather processing failed.",
            "trip": TripSerializer(trip).data,
            "route_error": str(error),
        }, status=status.HTTP_201_CREATED)
