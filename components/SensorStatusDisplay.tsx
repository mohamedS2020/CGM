import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SensorStatusService, SensorStatus } from '../services/SensorStatusService';
import { useNavigation } from '@react-navigation/native';

interface SensorStatusDisplayProps {
  onScanPress?: () => void;
}

const SensorStatusDisplay: React.FC<SensorStatusDisplayProps> = ({ onScanPress }) => {
  const [sensorStatus, setSensorStatus] = useState<SensorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation();

  useEffect(() => {
    // Get initial status
    const status = SensorStatusService.getStatus();
    setSensorStatus(status);
    setLoading(false);

    // Subscribe to status changes
    const statusListener = SensorStatusService.addEventListener('connectionStatusChanged', () => {
      const updatedStatus = SensorStatusService.getStatus();
      setSensorStatus(updatedStatus);
    });

    const activationListener = SensorStatusService.addEventListener('sensorActivated', (status: SensorStatus) => {
      setSensorStatus(status);
    });

    return () => {
      statusListener.remove();
      activationListener.remove();
    };
  }, []);

  const formatDate = (date: Date | null) => {
    if (!date) return 'N/A';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getRemainingTime = (expirationDate: Date | null) => {
    if (!expirationDate) return 'N/A';

    const now = new Date();
    const diffTime = expirationDate.getTime() - now.getTime();
    
    if (diffTime <= 0) {
      return 'Expired';
    }
    
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    return `${diffDays} day${diffDays !== 1 ? 's' : ''}, ${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
  };

  const handleScanPress = () => {
    if (onScanPress) {
      onScanPress();
    } else {
      // Default behavior is to navigate to scan screen
      navigation.navigate('StartSensor' as never);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color="#4361EE" />
        <Text style={styles.loadingText}>Loading sensor status...</Text>
      </View>
    );
  }

  if (!sensorStatus || !sensorStatus.serialNumber) {
    return (
      <View style={styles.noSensorContainer}>
        <Ionicons name="radio-outline" size={50} color="#ccc" />
        <Text style={styles.noSensorText}>No Active Sensor</Text>
        <Text style={styles.noSensorSubtext}>
          Connect a sensor to start monitoring your glucose levels
        </Text>
        <TouchableOpacity style={styles.scanButton} onPress={handleScanPress}>
          <Ionicons name="scan-outline" size={20} color="white" style={styles.buttonIcon} />
          <Text style={styles.scanButtonText}>Scan Sensor</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.statusIndicator}>
          <View 
            style={[
              styles.statusDot, 
              sensorStatus.isConnected ? styles.statusConnected : styles.statusDisconnected
            ]} 
          />
          <Text style={styles.statusText}>
            {sensorStatus.isConnected ? 'Connected' : 'Disconnected'}
          </Text>
        </View>

        <TouchableOpacity style={styles.scanButton} onPress={handleScanPress}>
          <Ionicons name="refresh" size={20} color="white" style={styles.buttonIcon} />
          <Text style={styles.scanButtonText}>Scan</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoContainer}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Serial Number:</Text>
          <Text style={styles.infoValue}>{sensorStatus.serialNumber}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Activated:</Text>
          <Text style={styles.infoValue}>{formatDate(sensorStatus.activationDate)}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Expires:</Text>
          <Text style={[
            styles.infoValue, 
            sensorStatus.isExpired ? styles.errorText : 
            sensorStatus.isExpiringSoon ? styles.warningText : null
          ]}>
            {formatDate(sensorStatus.expirationDate)}
            {sensorStatus.isExpired && ' (EXPIRED)'}
            {!sensorStatus.isExpired && sensorStatus.isExpiringSoon && ' (SOON)'}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Remaining Time:</Text>
          <Text style={[
            styles.infoValue, 
            sensorStatus.isExpired ? styles.errorText : 
            sensorStatus.isExpiringSoon ? styles.warningText : null
          ]}>
            {getRemainingTime(sensorStatus.expirationDate)}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Battery Level:</Text>
          <View style={styles.batteryContainer}>
            <View 
              style={[
                styles.batteryBar, 
                { width: `${sensorStatus.batteryLevel || 0}%` },
                sensorStatus.hasLowBattery ? styles.batteryLow : styles.batteryNormal
              ]} 
            />
            <Text style={[
              styles.batteryText, 
              sensorStatus.hasLowBattery ? styles.errorText : null
            ]}>
              {sensorStatus.batteryLevel !== null ? `${sensorStatus.batteryLevel}%` : 'Unknown'}
              {sensorStatus.hasLowBattery && ' (LOW)'}
            </Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Last Scan:</Text>
          <Text style={styles.infoValue}>
            {sensorStatus.lastScanTime ? formatDate(sensorStatus.lastScanTime) : 'Never'}
          </Text>
        </View>
      </View>

      {!sensorStatus.isConnected && (
        <TouchableOpacity 
          style={styles.reconnectButton} 
          onPress={handleScanPress}
        >
          <Ionicons name="refresh-circle" size={20} color="white" style={styles.buttonIcon} />
          <Text style={styles.reconnectButtonText}>Reconnect Sensor</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    marginVertical: 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  loadingContainer: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    marginVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  noSensorContainer: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    marginVertical: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  noSensorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 15,
  },
  noSensorSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusConnected: {
    backgroundColor: '#4CD964',
  },
  statusDisconnected: {
    backgroundColor: '#FF3B30',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4361EE',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  buttonIcon: {
    marginRight: 5,
  },
  scanButtonText: {
    color: 'white',
    fontWeight: '500',
  },
  infoContainer: {
    marginBottom: 15,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  infoLabel: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  infoValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  errorText: {
    color: '#FF3B30',
  },
  warningText: {
    color: '#FF9500',
  },
  batteryContainer: {
    flex: 2,
    alignItems: 'flex-end',
  },
  batteryBar: {
    height: 8,
    borderRadius: 4,
    marginBottom: 5,
    alignSelf: 'stretch',
  },
  batteryNormal: {
    backgroundColor: '#4CD964',
  },
  batteryLow: {
    backgroundColor: '#FF3B30',
  },
  batteryText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  reconnectButton: {
    flexDirection: 'row',
    backgroundColor: '#4CC9F0',
    padding: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reconnectButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 15,
  },
});

export default SensorStatusDisplay; 