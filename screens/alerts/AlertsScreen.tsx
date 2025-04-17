import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import MeasurementService, { GlucoseReading } from '../../services/MeasurementService';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';

// Mock glucose level ranges (same as in HomeScreen)
const GLUCOSE_LOW = 70;
const GLUCOSE_HIGH = 180;

const AlertsScreen = () => {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<GlucoseReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeframeFilter, setTimeframeFilter] = useState<'day' | 'week' | 'month' | 'all'>('week');
  
  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<GlucoseReading | null>(null);
  const [comment, setComment] = useState('');
  const [savingComment, setSavingComment] = useState(false);
  
  // Audio state
  const [sound, setSound] = useState<Audio.Sound | null>(null);

  // Fetch alerts from Firestore
  const fetchAlerts = useCallback(async () => {
    if (!user) return;
    
    try {
      const fetchedAlerts = await MeasurementService.getAlerts(user.uid, {
        timeframe: timeframeFilter,
        limit: 200
      });
      
      setAlerts(fetchedAlerts);
    } catch (error) {
      console.error('Error fetching alerts:', error);
      Alert.alert('Error', 'Failed to fetch glucose alerts');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, timeframeFilter]);

  // Handle refresh
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAlerts();
  }, [fetchAlerts]);

  // Load alerts when the component mounts or timeframe changes
  useEffect(() => {
    setLoading(true);
    fetchAlerts();
  }, [fetchAlerts, timeframeFilter]);

  // Open the comment modal
  const handleAlertPress = (alert: GlucoseReading) => {
    setSelectedAlert(alert);
    setComment(alert.comment || '');
    setModalVisible(true);
  };

  // Save comment to Firestore
  const saveComment = async () => {
    if (!user || !selectedAlert?.id) return;
    
    setSavingComment(true);
    
    try {
      await MeasurementService.updateReading(user.uid, selectedAlert.id, {
        comment
      });
      
      // Update the alerts list
      setAlerts(prevAlerts => prevAlerts.map(a => 
        a.id === selectedAlert.id ? { ...a, comment } : a
      ));
      
      // Close the modal
      setModalVisible(false);
      Alert.alert('Success', 'Comment saved successfully');
    } catch (error) {
      console.error('Error saving comment:', error);
      Alert.alert('Error', 'Failed to save comment');
    } finally {
      setSavingComment(false);
    }
  };

  // Play alert sound
  const playSound = async () => {
    try {
      // Clean up previous sound if it exists
      if (sound) {
        await sound.unloadAsync();
      }
      
      // Set audio mode
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
      
      // Create a new sound object
      const newSound = new Audio.Sound();
      setSound(newSound);
      
      // Generate a beep sound using native beep on most devices
      await newSound.loadAsync(require('expo-av/build/Audio/INTERRUPTION_BEGIN.mp3'));
      await newSound.setVolumeAsync(1.0);
      await newSound.setIsLoopingAsync(false);
      
      // Play the sound
      await newSound.playAsync();
      
      // Unload the sound after playing
      setTimeout(async () => {
        try {
          await newSound.unloadAsync();
        } catch (error) {
          console.error('Error unloading sound:', error);
        }
      }, 2000);
    } catch (error) {
      console.error('Error playing sound:', error);
    }
  };

  // Clean up sound on unmount
  useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [sound]);

  // Simulate an alert notification (for testing)
  const simulateAlert = async () => {
    // Create a mock reading with alert status
    const mockValue = Math.random() > 0.5 
      ? Math.floor(Math.random() * 30) + 40 // Low (40-69)
      : Math.floor(Math.random() * 50) + 181; // High (181-230)
    
    const mockAlert: GlucoseReading = {
      value: mockValue,
      timestamp: new Date(),
      isAlert: true
    };
    
    if (user) {
      // Add the alert to Firestore
      await MeasurementService.addReading(user.uid, mockAlert);
      
      // Play alert sound
      await playSound();
      
      // Show alert notification
      Alert.alert(
        'Glucose Alert',
        `${mockValue > GLUCOSE_HIGH ? 'High' : 'Low'} glucose level detected: ${mockValue} mg/dL`,
        [{ text: 'OK' }]
      );
      
      // Refresh the list
      fetchAlerts();
    }
  };

  // Format date for display
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Format time for display
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Determine alert type and color based on glucose level
  const getAlertInfo = (value: number) => {
    if (value < GLUCOSE_LOW) {
      return { color: '#F72585', text: 'Low', icon: 'arrow-down' };
    } else if (value > GLUCOSE_HIGH) {
      return { color: '#F72585', text: 'High', icon: 'arrow-up' };
    } else {
      return { color: '#4CC9F0', text: 'Normal', icon: 'remove' };
    }
  };

  // Group alerts by date
  const groupAlertsByDate = () => {
    const grouped: { [date: string]: GlucoseReading[] } = {};
    
    alerts.forEach(alert => {
      const dateString = formatDate(alert.timestamp);
      if (!grouped[dateString]) {
        grouped[dateString] = [];
      }
      grouped[dateString].push(alert);
    });
    
    return Object.entries(grouped).map(([date, dateAlerts]) => ({
      date,
      alerts: dateAlerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    }));
  };

  // Render alert item
  const renderAlertItem = ({ item }: { item: GlucoseReading }) => {
    const { color, text, icon } = getAlertInfo(item.value);
    
    return (
      <TouchableOpacity
        style={styles.alertItem}
        onPress={() => handleAlertPress(item)}
      >
        <View style={[styles.alertTypeIndicator, { backgroundColor: color }]}>
          <Ionicons name={icon as any} size={16} color="white" />
        </View>
        
        <View style={styles.alertContent}>
          <View style={styles.alertHeader}>
            <Text style={styles.alertTime}>{formatTime(item.timestamp)}</Text>
            <View style={styles.alertTypeContainer}>
              <Text style={[styles.alertType, { color }]}>{text}</Text>
            </View>
          </View>
          
          <View style={styles.alertDetails}>
            <Text style={styles.alertValue}>{item.value} mg/dL</Text>
            {item.comment ? (
              <Text style={styles.alertComment} numberOfLines={1}>
                {item.comment}
              </Text>
            ) : null}
          </View>
        </View>
        
        <View style={styles.commentIndicator}>
          {item.comment ? (
            <Ionicons name="chatbubble" size={16} color="#666" />
          ) : (
            <Ionicons name="chatbubble-outline" size={16} color="#999" />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // Render date section
  const renderDateSection = ({ item }: { item: { date: string, alerts: GlucoseReading[] } }) => (
    <View style={styles.dateSection}>
      <Text style={styles.dateSectionHeader}>{item.date}</Text>
      <View style={styles.dateSectionContent}>
        {item.alerts.map(alert => renderAlertItem({ item: alert }))}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Timeframe Filter */}
      <View style={styles.headerContainer}>
        <View style={styles.filterContainer}>
          <Text style={styles.filterLabel}>Time Range:</Text>
          <View style={styles.timeframeButtonContainer}>
            <TouchableOpacity
              style={[styles.timeframeButton, timeframeFilter === 'day' && styles.activeTimeframeButton]}
              onPress={() => setTimeframeFilter('day')}
            >
              <Text style={[styles.timeframeText, timeframeFilter === 'day' && styles.activeTimeframeText]}>
                Day
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.timeframeButton, timeframeFilter === 'week' && styles.activeTimeframeButton]}
              onPress={() => setTimeframeFilter('week')}
            >
              <Text style={[styles.timeframeText, timeframeFilter === 'week' && styles.activeTimeframeText]}>
                Week
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.timeframeButton, timeframeFilter === 'month' && styles.activeTimeframeButton]}
              onPress={() => setTimeframeFilter('month')}
            >
              <Text style={[styles.timeframeText, timeframeFilter === 'month' && styles.activeTimeframeText]}>
                Month
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.timeframeButton, timeframeFilter === 'all' && styles.activeTimeframeButton]}
              onPress={() => setTimeframeFilter('all')}
            >
              <Text style={[styles.timeframeText, timeframeFilter === 'all' && styles.activeTimeframeText]}>
                All
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        
        {/* Test button for simulating an alert (for development) */}
        {__DEV__ && (
          <TouchableOpacity
            style={styles.simulateButton}
            onPress={simulateAlert}
          >
            <Ionicons name="add-circle" size={18} color="white" />
            <Text style={styles.simulateButtonText}>Test Alert</Text>
          </TouchableOpacity>
        )}
      </View>
      
      {/* Alerts List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4361EE" />
          <Text style={styles.loadingText}>Loading alerts...</Text>
        </View>
      ) : alerts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#ccc" />
          <Text style={styles.emptyText}>No alerts found</Text>
          <Text style={styles.emptySubtext}>All your glucose readings are within normal range</Text>
        </View>
      ) : (
        <FlatList
          data={groupAlertsByDate()}
          renderItem={renderDateSection}
          keyExtractor={item => item.date}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#4361EE']}
            />
          }
        />
      )}
      
      {/* Comment Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Alert Details</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setModalVisible(false)}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            {selectedAlert && (
              <View style={styles.modalBody}>
                <View style={styles.alertDetailRow}>
                  <Text style={styles.alertDetailLabel}>Date:</Text>
                  <Text style={styles.alertDetailValue}>
                    {formatDate(selectedAlert.timestamp)}
                  </Text>
                </View>
                
                <View style={styles.alertDetailRow}>
                  <Text style={styles.alertDetailLabel}>Time:</Text>
                  <Text style={styles.alertDetailValue}>
                    {formatTime(selectedAlert.timestamp)}
                  </Text>
                </View>
                
                <View style={styles.alertDetailRow}>
                  <Text style={styles.alertDetailLabel}>Value:</Text>
                  <View style={styles.valueContainer}>
                    <Text style={styles.modalAlertValue}>{selectedAlert.value}</Text>
                    <Text style={styles.modalAlertUnit}>mg/dL</Text>
                  </View>
                </View>
                
                <View style={styles.alertDetailRow}>
                  <Text style={styles.alertDetailLabel}>Type:</Text>
                  <View style={styles.alertTypeDisplayContainer}>
                    <View 
                      style={[
                        styles.alertTypeDot, 
                        { backgroundColor: getAlertInfo(selectedAlert.value).color }
                      ]}
                    />
                    <Text 
                      style={[
                        styles.modalAlertTypeText, 
                        { color: getAlertInfo(selectedAlert.value).color }
                      ]}
                    >
                      {getAlertInfo(selectedAlert.value).text}
                    </Text>
                  </View>
                </View>
                
                <View style={styles.commentContainer}>
                  <Text style={styles.commentLabel}>Comment:</Text>
                  <TextInput
                    style={styles.commentInput}
                    multiline
                    placeholder="Add a comment about this alert"
                    value={comment}
                    onChangeText={setComment}
                  />
                </View>
                
                <TouchableOpacity
                  style={styles.saveButton}
                  onPress={saveComment}
                  disabled={savingComment}
                >
                  {savingComment ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveButtonText}>Save Comment</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  headerContainer: {
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  filterContainer: {
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 10,
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
    marginBottom: 8,
  },
  timeframeButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeframeButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: '#E0E7FF',
  },
  activeTimeframeButton: {
    backgroundColor: '#4361EE',
  },
  timeframeText: {
    fontSize: 14,
    color: '#4361EE',
  },
  activeTimeframeText: {
    color: 'white',
  },
  simulateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F72585',
    marginHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 10,
  },
  simulateButtonText: {
    color: 'white',
    marginLeft: 5,
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#666',
    marginTop: 20,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 10,
  },
  listContent: {
    paddingBottom: 20,
  },
  dateSection: {
    marginBottom: 15,
  },
  dateSectionHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    backgroundColor: '#eee',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  dateSectionContent: {
    backgroundColor: 'white',
  },
  alertItem: {
    flexDirection: 'row',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    alignItems: 'center',
  },
  alertTypeIndicator: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  alertContent: {
    flex: 1,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  alertTime: {
    fontSize: 14,
    color: '#666',
    marginRight: 10,
  },
  alertTypeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  alertType: {
    fontSize: 14,
    fontWeight: '500',
  },
  alertDetails: {
    flexDirection: 'column',
  },
  alertValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  alertComment: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  commentIndicator: {
    marginLeft: 10,
    width: 30,
    alignItems: 'center',
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
    paddingBottom: 30, // Add extra padding for iPhone X and above
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    padding: 5,
  },
  modalBody: {
    padding: 20,
  },
  alertDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  alertDetailLabel: {
    fontSize: 16,
    color: '#666',
    width: 80,
  },
  alertDetailValue: {
    fontSize: 16,
    color: '#333',
    flex: 1,
  },
  valueContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  modalAlertValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  modalAlertUnit: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  alertTypeDisplayContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  alertTypeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  modalAlertTypeText: {
    fontSize: 16,
    fontWeight: '500',
  },
  commentContainer: {
    marginTop: 10,
    marginBottom: 20,
  },
  commentLabel: {
    fontSize: 16,
    color: '#666',
    marginBottom: 10,
  },
  commentInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: 'top',
    backgroundColor: '#f9f9f9',
  },
  saveButton: {
    backgroundColor: '#4361EE',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default AlertsScreen; 