import React, { useEffect, useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Modal, 
  FlatList, 
  Alert 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SensorStatusService, SensorAlert } from '../services/SensorStatusService';
import { useNavigation } from '@react-navigation/native';

const SensorAlertComponent = () => {
  const [alerts, setAlerts] = useState<SensorAlert[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [hasUnreadAlerts, setHasUnreadAlerts] = useState(false);
  const navigation = useNavigation();

  useEffect(() => {
    // Subscribe to sensor alerts
    const alertListener = SensorStatusService.addEventListener('sensorAlert', (alert: SensorAlert) => {
      // Check if the alert already exists in our list to avoid duplicates
      setAlerts(currentAlerts => {
        const exists = currentAlerts.some(a => a.id === alert.id);
        if (exists) return currentAlerts;
        return [alert, ...currentAlerts];
      });
      setHasUnreadAlerts(true);
      
      // Show immediate alert for critical issues
      if (alert.type === 'EXPIRED' || alert.type === 'LOW_BATTERY') {
        Alert.alert('Sensor Alert', alert.message, [
          { text: 'View Details', onPress: () => setShowModal(true) },
          { text: 'Dismiss', style: 'cancel' }
        ]);
      }
    });

    // Load initial alerts
    const unreadAlerts = SensorStatusService.getUnreadAlerts();
    if (unreadAlerts.length > 0) {
      setAlerts(unreadAlerts);
      setHasUnreadAlerts(true);
    }

    // Clean up subscription
    return () => {
      alertListener.remove();
    };
  }, []);

  const handleAlertPress = (alert: SensorAlert) => {
    // Mark this alert as read
    SensorStatusService.markAlertAsRead(alert.id);
    
    // Update our local state
    setAlerts(currentAlerts => 
      currentAlerts.map(a => 
        a.id === alert.id ? { ...a, isRead: true } : a
      )
    );
    
    // Check if we still have any unread alerts
    const stillHasUnread = alerts.some(a => a.id !== alert.id && !a.isRead);
    setHasUnreadAlerts(stillHasUnread);

    // Handle specific alert types
    if (alert.type === 'EXPIRED' || alert.type === 'EXPIRING_SOON') {
      // Navigate to start sensor screen
      navigation.navigate('StartSensor' as never);
    } else if (alert.type === 'DISCONNECTED') {
      // Navigate to settings or reconnect flow
      navigation.navigate('StartSensor' as never);
    }
  };

  const clearAllAlerts = () => {
    SensorStatusService.clearAlerts();
    setAlerts([]);
    setHasUnreadAlerts(false);
    setShowModal(false);
  };

  const formatAlertTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Don't render anything if there are no alerts
  if (alerts.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Alert indicator button */}
      <TouchableOpacity 
        style={[styles.alertButton, hasUnreadAlerts && styles.alertButtonActive]} 
        onPress={() => setShowModal(true)}
      >
        <Ionicons 
          name={hasUnreadAlerts ? "alert-circle" : "alert-circle-outline"} 
          size={24} 
          color={hasUnreadAlerts ? "#FF3B30" : "#666"} 
        />
        {hasUnreadAlerts && <View style={styles.unreadDot} />}
      </TouchableOpacity>

      {/* Alerts modal */}
      <Modal
        visible={showModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sensor Alerts</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            {alerts.length > 0 ? (
              <>
                <FlatList
                  data={alerts}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity 
                      style={[styles.alertItem, item.isRead && styles.readAlert]}
                      onPress={() => handleAlertPress(item)}
                    >
                      <View style={styles.alertIconContainer}>
                        <Ionicons 
                          name={getAlertIcon(item.type) as any} 
                          size={24} 
                          color={getAlertColor(item.type)} 
                        />
                      </View>
                      <View style={styles.alertContent}>
                        <Text style={styles.alertType}>{getAlertTitle(item.type)}</Text>
                        <Text style={styles.alertMessage}>{item.message}</Text>
                        <Text style={styles.alertTime}>{formatAlertTime(item.timestamp)}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color="#ccc" />
                    </TouchableOpacity>
                  )}
                  contentContainerStyle={styles.alertsList}
                />
                
                <TouchableOpacity style={styles.clearButton} onPress={clearAllAlerts}>
                  <Text style={styles.clearButtonText}>Clear All Alerts</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.noAlertsContainer}>
                <Ionicons name="checkmark-circle" size={64} color="#4CC9F0" />
                <Text style={styles.noAlertsText}>No Alerts</Text>
                <Text style={styles.noAlertsSubtext}>Your sensor is working normally</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

// Helper functions for alert appearance
const getAlertColor = (type: SensorAlert['type']): string => {
  switch (type) {
    case 'EXPIRED':
    case 'LOW_BATTERY':
      return '#FF3B30'; // Red for critical
    case 'EXPIRING_SOON':
      return '#FF9500'; // Orange for warning
    case 'DISCONNECTED':
      return '#007AFF'; // Blue for info
    default:
      return '#666';
  }
};

const getAlertIcon = (type: SensorAlert['type']): string => {
  switch (type) {
    case 'EXPIRED':
      return 'time';
    case 'LOW_BATTERY':
      return 'battery-dead';
    case 'EXPIRING_SOON':
      return 'timer-outline';
    case 'DISCONNECTED':
      return 'wifi-off';
    default:
      return 'alert-circle';
  }
};

const getAlertTitle = (type: SensorAlert['type']): string => {
  switch (type) {
    case 'EXPIRED':
      return 'Sensor Expired';
    case 'LOW_BATTERY':
      return 'Low Battery';
    case 'EXPIRING_SOON':
      return 'Sensor Expiring Soon';
    case 'DISCONNECTED':
      return 'Sensor Disconnected';
    default:
      return 'Alert';
  }
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 1000,
  },
  alertButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'white',
    justifyContent: 'center',
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
  alertButtonActive: {
    backgroundColor: '#FFF5F5',
  },
  unreadDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
  },
  alertsList: {
    paddingBottom: 20,
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    marginBottom: 10,
  },
  readAlert: {
    opacity: 0.7,
    backgroundColor: '#F0F0F0',
  },
  alertIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  alertContent: {
    flex: 1,
  },
  alertType: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  alertMessage: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  alertTime: {
    fontSize: 12,
    color: '#999',
  },
  clearButton: {
    backgroundColor: '#F0F0F0',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  clearButtonText: {
    color: '#666',
    fontWeight: '500',
  },
  noAlertsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
  },
  noAlertsText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  noAlertsSubtext: {
    color: '#666',
    fontSize: 16,
  },
});

export default SensorAlertComponent; 