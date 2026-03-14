interface Trip {
  id: string;
  startedAt: number;
  scannedSubtotal: number;
  actualTotal?: number;
  status: string;
}

interface TripCardProps {
  trip: Trip;
  storeName: string;
  onPress?: (trip: Trip) => void;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-blue-100 text-blue-800";
    case "completed":
      return "bg-green-100 text-green-800";
    case "cancelled":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

export function TripCard({ trip, storeName, onPress }: TripCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-gray-900">{storeName}</p>
          <p className="text-sm text-gray-500 mt-0.5">
            {formatDate(trip.startedAt)}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(trip.status)}`}
        >
          {trip.status}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-4 text-sm">
        <div>
          <span className="text-gray-500">Subtotal: </span>
          <span className="font-medium text-gray-900">
            ${trip.scannedSubtotal.toFixed(2)}
          </span>
        </div>
        {trip.actualTotal !== undefined && (
          <div>
            <span className="text-gray-500">Actual: </span>
            <span className="font-medium text-gray-900">
              ${trip.actualTotal.toFixed(2)}
            </span>
          </div>
        )}
      </div>
    </>
  );

  const className = "bg-white rounded-lg border p-4";

  if (onPress) {
    return (
      <button
        type="button"
        onClick={() => onPress(trip)}
        className={`${className} w-full text-left hover:bg-gray-50 transition-colors cursor-pointer`}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}
