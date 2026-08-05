import React, { useState } from "react";
import { X, MapPin, Navigation, Loader2, Save, Store, Phone, Search } from "lucide-react";
import { toast } from "sonner";
import { franchiseApi } from "../../services/franchiseApi";
import MapPicker from "@shared/components/MapPicker";

export const EditFranchiseLocationModal = ({ partner, onClose, onUpdated }) => {
  const [saving, setSaving] = useState(false);
  const [gettingGps, setGettingGps] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);

  const [displayName, setDisplayName] = useState(partner?.displayName || "");
  const [phone, setPhone] = useState(partner?.phone || "");
  const [address, setAddress] = useState(partner?.address || "");
  const [locality, setLocality] = useState(partner?.locality || "");
  const [pincode, setPincode] = useState(partner?.pincode || "");
  const [city, setCity] = useState(partner?.city || "");
  const [state, setState] = useState(partner?.state || "");

  const initialCoords = partner?.location?.coordinates;
  const [lat, setLat] = useState(initialCoords && initialCoords[1] ? String(initialCoords[1]) : "");
  const [lng, setLng] = useState(initialCoords && initialCoords[0] ? String(initialCoords[0]) : "");

  const handleLocationSelectFromMap = (location) => {
    if (!location) return;
    if (location.lat) setLat(String(location.lat));
    if (location.lng) setLng(String(location.lng));
    if (location.address) setAddress(location.address);
    if (location.locality) setLocality(location.locality);
    if (location.pincode) setPincode(location.pincode);
    if (location.city) setCity(location.city);
    if (location.state) setState(location.state);
    setIsMapOpen(false);
    toast.success("Location updated from Google Maps");
  };

  const handleGetGpsLocation = () => {
    if (!navigator.geolocation) {
      return toast.error("Geolocation is not supported by your browser");
    }
    setGettingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latitude = pos.coords.latitude;
        const longitude = pos.coords.longitude;
        setLat(String(latitude.toFixed(6)));
        setLng(String(longitude.toFixed(6)));
        toast.success(`GPS coordinates captured: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
        setGettingGps(false);
      },
      (err) => {
        toast.error(err.message || "Failed to retrieve GPS location");
        setGettingGps(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        displayName: displayName.trim(),
        phone: phone.trim(),
        address: address.trim(),
        locality: locality.trim(),
        pincode: pincode.trim(),
        city: city.trim(),
        state: state.trim(),
        lat: lat ? Number(lat) : null,
        lng: lng ? Number(lng) : null,
      };

      const res = await franchiseApi.updateLocation(payload);
      const updated = res.data?.result?.partner ?? res.data?.data?.partner;
      toast.success("Franchise location updated successfully");
      if (onUpdated) onUpdated(updated);
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update franchise location");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
            <div>
              <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <MapPin className="text-indigo-600" size={20} /> Update Store Location
              </h2>
              <p className="text-xs text-slate-500">Edit address & Google Maps location for order routing.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100"
            >
              <X size={20} />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            {/* Google Map Trigger Button */}
            <div className="bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-100 rounded-2xl p-3.5 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black text-indigo-900 flex items-center gap-1.5">
                  <MapPin size={15} className="text-indigo-600" /> Select on Google Maps
                </p>
                <p className="text-[11px] text-indigo-700/80 mt-0.5">
                  Pin your store location directly on Google Maps
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsMapOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-extrabold uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md transition-all shrink-0"
              >
                <Search size={14} /> Open Map
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Store / Display Name
                </label>
                <div className="relative">
                  <Store className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. City Central Shoppy"
                    className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Store Phone Number
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +91 9876543210"
                    className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Full Street Address
              </label>
              <textarea
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Shop No., Building Name, Main Road…"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Locality / Area</label>
                <input
                  type="text"
                  value={locality}
                  onChange={(e) => setLocality(e.target.value)}
                  placeholder="e.g. Station Road"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Pincode</label>
                <input
                  type="text"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  placeholder="6-digit pincode"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">City</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City name"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">State</label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="State name"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white"
                />
              </div>
            </div>

            {/* GPS Coordinates Section */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                  <Navigation size={14} className="text-indigo-600" /> GPS Geolocation
                </span>
                <button
                  type="button"
                  onClick={handleGetGpsLocation}
                  disabled={gettingGps}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50"
                >
                  {gettingGps ? <Loader2 size={12} className="animate-spin" /> : <Navigation size={12} />}
                  Use Current GPS
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    placeholder="e.g. 19.0760"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                    placeholder="e.g. 72.8777"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Save Location
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Google Map Picker Modal */}
      <MapPicker
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
        onConfirm={handleLocationSelectFromMap}
        onSelectLocation={handleLocationSelectFromMap}
        showRadius={false}
        initialLocation={
          lat && lng
            ? { lat: Number(lat), lng: Number(lng) }
            : undefined
        }
      />
    </>
  );
};

export default EditFranchiseLocationModal;
