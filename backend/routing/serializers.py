
from rest_framework import serializers
from .models import Trip


class TripSerializer(serializers.ModelSerializer):

    class Meta:
        model = Trip
        fields = '__all__'
        read_only_fields = ['id', 'created_at']

    def validate_load_weight(self, value):
        if value <= 0:
            raise serializers.ValidationError(
                "Truck load must be greater than zero."
            )
        return value

    def validate_checkpoint_interval(self, value):
        if value not in [10, 25, 50]:
            raise serializers.ValidationError(
                "Checkpoint interval must be 10, 25, or 50 miles."
            )
        return value
