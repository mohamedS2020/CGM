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
  RefreshControl,
  Dimensions
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import MeasurementService, { GlucoseReading } from '../../services/MeasurementService';
import { Ionicons } from '@expo/vector-icons';
import GlucoseReadingEvents from '../../services/GlucoseReadingEvents';

// Mock glucose level ranges (same as in HomeScreen)
const GLUCOSE_LOW = 70;
const GLUCOSE_HIGH = 180;

// Screen width for responsive styles
const { width } = Dimensions.get('window');

const HistoryScreen = () => {
  const { user } = useAuth();
  const [readings, setReadings] = useState<GlucoseReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeframeFilter, setTimeframeFilter] = useState<'day' | 'week' | 'month' | 'all'>('week');
  
  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedReading, setSelectedReading] = useState<GlucoseReading | null>(null);
  const [comment, setComment] = useState('');
  const [savingComment, setSavingComment] = useState(false);

  // Fetch readings from Firestore
  const fetchReadings = useCallback(async () => {
    if (!user) return;
    
    try {
      const fetchedReadings = await MeasurementService.getReadings(user.uid, {
        timeframe: timeframeFilter,
        limit: 200
      });
      
      setReadings(fetchedReadings);
    } catch (error) {
      console.error('Error fetching readings:', error);
      Alert.alert('Error', 'Failed to fetch glucose readings');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, timeframeFilter]);

  // Handle refresh
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchReadings();
  }, [fetchReadings]);

  // Load readings when the component mounts or timeframe changes
  useEffect(() => {
    setLoading(true);
    fetchReadings();
  }, [fetchReadings, timeframeFilter]);

  // Subscribe to real-time reading updates
  useEffect(() => {
    // Subscribe to new reading events
    const subscription = GlucoseReadingEvents.getInstance().addNewReadingListener((newReading) => {
      console.log('[HistoryScreen] New reading event received:', newReading);
      
      // Update the readings list
      setReadings(prevReadings => {
        // Check if reading already exists (by ID or by timestamp for offline readings)
        const existingIndex = prevReadings.findIndex(r => 
          r.id === newReading.id || 
          (r.timestamp.getTime() === newReading.timestamp.getTime() && r.value === newReading.value)
        );
        
        if (existingIndex >= 0) {
          // Replace the existing reading
          const updatedReadings = [...prevReadings];
          updatedReadings[existingIndex] = newReading;
          return updatedReadings;
        } else {
          // Add the new reading
          const updatedReadings = [newReading, ...prevReadings];
          
          // Sort by timestamp (newest first)
          updatedReadings.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
          
          return updatedReadings;
        }
      });
    });
    
    return () => {
      // Clean up the subscription on unmount
      subscription.remove();
    };
  }, []);

  // Open the comment modal
  const handleReadingPress = (reading: GlucoseReading) => {
    setSelectedReading(reading);
    setComment(reading.comment || '');
    setModalVisible(true);
  };

  // Save comment to Firestore
  const saveComment = async () => {
    if (!user || !selectedReading?.id) return;
    
    setSavingComment(true);
    
    try {
      await MeasurementService.updateReading(user.uid, selectedReading.id, {
        comment
      });
      
      // Update the readings list
      setReadings(prevReadings => prevReadings.map(r => 
        r.id === selectedReading.id ? { ...r, comment } : r
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

  // Determine status text and color based on glucose level
  const getStatusInfo = (value: number) => {
    if (value < GLUCOSE_LOW) {
      return { color: '#F72585', text: 'Low' };
    } else if (value > GLUCOSE_HIGH) {
      return { color: '#F72585', text: 'High' };
    } else {
      return { color: '#4CC9F0', text: 'Normal' };
    }
  };

  // Group readings by date
  const groupReadingsByDate = () => {
    const grouped: { [date: string]: GlucoseReading[] } = {};
    
    readings.forEach(reading => {
      const dateString = formatDate(reading.timestamp);
      if (!grouped[dateString]) {
        grouped[dateString] = [];
      }
      grouped[dateString].push(reading);
    });
    
    return Object.entries(grouped).map(([date, dateReadings]) => ({
      date,
      readings: dateReadings.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    }));
  };

  // Render reading item
  const renderReadingItem = ({ item }: { item: GlucoseReading }) => {
    const { color, text } = getStatusInfo(item.value);
    
    return (
      <TouchableOpacity
        style={styles.readingItem}
        onPress={() => handleReadingPress(item)}
      >
        <View style={styles.readingTimeContainer}>
          <Text style={styles.readingTime}>{formatTime(item.timestamp)}</Text>
        </View>
        
        <View style={styles.readingValueContainer}>
          <Text style={styles.readingValue}>{item.value}</Text>
          <Text style={styles.readingUnit}>mg/dL</Text>
        </View>
        
        <View style={styles.readingStatusContainer}>
          <View style={[styles.statusIndicator, { backgroundColor: color }]} />
          <Text style={[styles.readingStatus, { color }]}>{text}</Text>
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
  const renderDateSection = ({ item }: { item: { date: string, readings: GlucoseReading[] } }) => (
    <View style={styles.dateSection}>
      <Text style={styles.dateSectionHeader}>{item.date}</Text>
      <View style={styles.dateSectionContent}>
        {item.readings.map(reading => (
          <React.Fragment key={reading.id}>
            {renderReadingItem({ item: reading })}
          </React.Fragment>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Timeframe Filter */}
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
      
      {/* Reading List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4361EE" />
          <Text style={styles.loadingText}>Loading readings...</Text>
        </View>
      ) : readings.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="document-outline" size={64} color="#ccc" />
          <Text style={styles.emptyText}>No readings found</Text>
          <Text style={styles.emptySubtext}>Try scanning your sensor or changing the time filter</Text>
        </View>
      ) : (
        <FlatList
          data={groupReadingsByDate()}
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
              <Text style={styles.modalTitle}>Glucose Reading</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setModalVisible(false)}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            {selectedReading && (
              <View style={styles.modalBody}>
                <View style={styles.readingDetails}>
                  <Text style={styles.readingDetailLabel}>Date:</Text>
                  <Text style={styles.readingDetailValue}>
                    {formatDate(selectedReading.timestamp)}
                  </Text>
                </View>
                
                <View style={styles.readingDetails}>
                  <Text style={styles.readingDetailLabel}>Time:</Text>
                  <Text style={styles.readingDetailValue}>
                    {formatTime(selectedReading.timestamp)}
                  </Text>
                </View>
                
                <View style={styles.readingDetails}>
                  <Text style={styles.readingDetailLabel}>Value:</Text>
                  <View style={styles.valueContainer}>
                    <Text style={styles.modalReadingValue}>{selectedReading.value}</Text>
                    <Text style={styles.modalReadingUnit}>mg/dL</Text>
                  </View>
                </View>
                
                <View style={styles.readingDetails}>
                  <Text style={styles.readingDetailLabel}>Status:</Text>
                  <View style={styles.statusContainer}>
                    <View 
                      style={[
                        styles.statusIndicator, 
                        { backgroundColor: getStatusInfo(selectedReading.value).color }
                      ]}
                    />
                    <Text 
                      style={[
                        styles.modalStatusText, 
                        { color: getStatusInfo(selectedReading.value).color }
                      ]}
                    >
                      {getStatusInfo(selectedReading.value).text}
                    </Text>
                  </View>
                </View>
                
                <View style={styles.commentContainer}>
                  <Text style={styles.commentLabel}>Comment:</Text>
                  <TextInput
                    style={styles.commentInput}
                    multiline
                    placeholder="Add a comment about this reading"
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
  filterContainer: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
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
    paddingBottom: 120,
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
  readingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  readingTimeContainer: {
    width: 70,
  },
  readingTime: {
    fontSize: 14,
    color: '#666',
  },
  readingValueContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    width: 90,
  },
  readingValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  readingUnit: {
    fontSize: 12,
    color: '#666',
    marginLeft: 4,
  },
  readingStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  readingStatus: {
    fontSize: 14,
    fontWeight: '500',
  },
  commentIndicator: {
    marginLeft: 'auto',
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
  readingDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  readingDetailLabel: {
    fontSize: 16,
    color: '#666',
    width: 80,
  },
  readingDetailValue: {
    fontSize: 16,
    color: '#333',
    flex: 1,
  },
  valueContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  modalReadingValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  modalReadingUnit: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalStatusText: {
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

export default HistoryScreen; 