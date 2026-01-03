import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  subscribeActiveVehicles,
  subscribeActiveLuggage,
  subscribeActiveAmenities,
} from '../services/valetFirestore';

export default function Dashboard() {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState([]);
  const [luggageItems, setLuggageItems] = useState([]);
  const [amenityItems, setAmenityItems] = useState([]);

  // Subscribe to all active data
  useEffect(() => {
    const unsubVehicles = subscribeActiveVehicles((allVehicles) => {
      // Filter out any vehicles that shouldn't be counted (just active ones)
      const activeVehicles = allVehicles.filter(v => 
        v.status !== 'archived' && v.status !== 'deleted'
      );
      setVehicles(activeVehicles);
    });
    const unsubLuggage = subscribeActiveLuggage(setLuggageItems);
    const unsubAmenities = subscribeActiveAmenities(setAmenityItems);

    return () => {
      unsubVehicles && unsubVehicles();
      unsubLuggage && unsubLuggage();
      unsubAmenities && unsubAmenities();
    };
  }, []);

  // Calculate valet statistics
  const totalVehicles = vehicles.length;
  const inHouseVehicles = vehicles.filter(v => v.status === 'parked' || v.status === 'received' || v.status === 'requested' || v.status === 'retrieving' || v.status === 'ready').length;
  const outVehicles = vehicles.filter(v => v.status === 'out').length;
  
  // Get today's date for departure comparison
  const today = new Date().toISOString().split('T')[0];
  const departingToday = vehicles.filter(v => v.departureDate === today).length;

  // Calculate luggage statistics
  const storedLuggage = luggageItems.filter(item => item.status === 'stored');
  const deliveredLuggage = luggageItems.filter(item => item.status === 'delivered');
  const totalBagsToDeliver = storedLuggage.reduce((sum, item) => sum + (item.numberOfBags || 0), 0);
  
  // Split by room readiness
  const readyToDeliver = storedLuggage.filter(item => item.roomStatus === 'clean');
  const readyBagsCount = readyToDeliver.reduce((sum, item) => sum + (item.numberOfBags || 0), 0);
  
  const notReadyToDeliver = storedLuggage.filter(item => item.roomStatus !== 'clean');
  const notReadyBagsCount = notReadyToDeliver.reduce((sum, item) => sum + (item.numberOfBags || 0), 0);

  // Calculate amenities statistics
  const getTodayDate = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };
  
  const todayDate = getTodayDate();
  const todayAmenities = amenityItems.filter(item => item.deliveryDate === todayDate);
  const outstandingAmenities = todayAmenities.filter(item => item.status === 'outstanding');
  const deliveredAmenities = todayAmenities.filter(item => item.status === 'delivered');
  
  // Split outstanding amenities by room readiness
  const amenitiesReadyToDeliver = outstandingAmenities.filter(item => item.roomStatus === 'clean');
  const amenitiesNotReady = outstandingAmenities.filter(item => item.roomStatus !== 'clean');

  return (
    <div className="page pad">
      <h2 style={{ marginBottom: 24 }}>Dashboard</h2>

      {/* Valet Overview */}
      <section className="card pad" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Valet Overview</h3>
          <button className="btn secondary" onClick={() => navigate('/valet')}>
            View Details →
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div className="stat-card" style={{ 
            padding: 20, 
            backgroundColor: '#f8f9fa', 
            borderRadius: 8,
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 36, fontWeight: 'bold', color: '#2196F3', marginBottom: 8 }}>
              {totalVehicles}
            </div>
            <div style={{ fontSize: 14, opacity: 0.7 }}>Total Vehicles</div>
          </div>
          
          <div className="stat-card" style={{ 
            padding: 20, 
            backgroundColor: '#f8f9fa', 
            borderRadius: 8,
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 36, fontWeight: 'bold', color: '#4CAF50', marginBottom: 8 }}>
              {inHouseVehicles}
            </div>
            <div style={{ fontSize: 14, opacity: 0.7 }}>In House</div>
          </div>
          
          <div className="stat-card" style={{ 
            padding: 20, 
            backgroundColor: '#f8f9fa', 
            borderRadius: 8,
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 36, fontWeight: 'bold', color: '#FF9800', marginBottom: 8 }}>
              {outVehicles}
            </div>
            <div style={{ fontSize: 14, opacity: 0.7 }}>Out with Guests</div>
          </div>
          
          <div className="stat-card" style={{ 
            padding: 20, 
            backgroundColor: '#f8f9fa', 
            borderRadius: 8,
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 36, fontWeight: 'bold', color: '#9C27B0', marginBottom: 8 }}>
              {departingToday}
            </div>
            <div style={{ fontSize: 14, opacity: 0.7 }}>Departing Today</div>
          </div>
        </div>
      </section>

      {/* Luggage Overview */}
      <section className="card pad" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Luggage Overview</h3>
          <button className="btn secondary" onClick={() => navigate('/luggage')}>
            View Details →
          </button>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 20 }}>
          <div style={{ 
            padding: 16, 
            backgroundColor: '#f8f9fa', 
            borderRadius: 8,
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 32, fontWeight: 'bold', color: '#2196F3', marginBottom: 8 }}>
              {totalBagsToDeliver}
            </div>
            <div style={{ fontSize: 14, opacity: 0.7 }}>Bags to Deliver</div>
          </div>
          
          <div style={{ 
            padding: 16, 
            backgroundColor: '#f8f9fa', 
            borderRadius: 8,
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 32, fontWeight: 'bold', color: '#4CAF50', marginBottom: 8 }}>
              {deliveredLuggage.length}
            </div>
            <div style={{ fontSize: 14, opacity: 0.7 }}>Delivered Today</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
          <div style={{ 
            padding: 20, 
            backgroundColor: '#e8f5e9', 
            borderRadius: 8,
            border: '2px solid #4CAF50'
          }}>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 12, fontWeight: 500 }}>
              🟢 Ready to Deliver
            </div>
            <div style={{ fontSize: 28, fontWeight: 'bold', color: '#2e7d32', marginBottom: 8 }}>
              {readyBagsCount} bags
            </div>
            <div style={{ fontSize: 13, opacity: 0.7 }}>
              {readyToDeliver.length} guest{readyToDeliver.length !== 1 ? 's' : ''} • Room is clean
            </div>
          </div>

          <div style={{ 
            padding: 20, 
            backgroundColor: '#fff3e0', 
            borderRadius: 8,
            border: '2px solid #FF9800'
          }}>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 12, fontWeight: 500 }}>
              ⏳ Waiting for Room
            </div>
            <div style={{ fontSize: 28, fontWeight: 'bold', color: '#e65100', marginBottom: 8 }}>
              {notReadyBagsCount} bags
            </div>
            <div style={{ fontSize: 13, opacity: 0.7 }}>
              {notReadyToDeliver.length} guest{notReadyToDeliver.length !== 1 ? 's' : ''} • Room not ready
            </div>
          </div>
        </div>
      </section>

      {/* Amenities Overview */}
      <section className="card pad">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Amenities Overview</h3>
          <button className="btn secondary" onClick={() => navigate('/amenities')}>
            View Details →
          </button>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 20 }}>
          <div style={{ 
            padding: 16, 
            backgroundColor: '#f8f9fa', 
            borderRadius: 8,
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 32, fontWeight: 'bold', color: '#2196F3', marginBottom: 8 }}>
              {todayAmenities.length}
            </div>
            <div style={{ fontSize: 14, opacity: 0.7 }}>Total Today</div>
          </div>
          
          <div style={{ 
            padding: 16, 
            backgroundColor: '#f8f9fa', 
            borderRadius: 8,
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 32, fontWeight: 'bold', color: '#4CAF50', marginBottom: 8 }}>
              {deliveredAmenities.length}
            </div>
            <div style={{ fontSize: 14, opacity: 0.7 }}>Delivered</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
          <div style={{ 
            padding: 20, 
            backgroundColor: '#e8f5e9', 
            borderRadius: 8,
            border: '2px solid #4CAF50'
          }}>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 12, fontWeight: 500 }}>
              🟢 Ready to Deliver
            </div>
            <div style={{ fontSize: 28, fontWeight: 'bold', color: '#2e7d32', marginBottom: 8 }}>
              {amenitiesReadyToDeliver.length}
            </div>
            <div style={{ fontSize: 13, opacity: 0.7 }}>Room is clean</div>
          </div>

          <div style={{ 
            padding: 20, 
            backgroundColor: '#fff3e0', 
            borderRadius: 8,
            border: '2px solid #FF9800'
          }}>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 12, fontWeight: 500 }}>
              ⏳ Waiting for Room
            </div>
            <div style={{ fontSize: 28, fontWeight: 'bold', color: '#e65100', marginBottom: 8 }}>
              {amenitiesNotReady.length}
            </div>
            <div style={{ fontSize: 13, opacity: 0.7 }}>Room not ready</div>
          </div>
        </div>
      </section>
    </div>
  );
}
