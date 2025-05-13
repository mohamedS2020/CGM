import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Dimensions, Vibration } from 'react-native';
import { GlucoseAlert } from '../services/AlertService';

interface AlertModalProps {
  alert: GlucoseAlert | null;
  onDismiss: () => void;
}

const AlertModal: React.FC<AlertModalProps> = ({ alert, onDismiss }) => {
  // Start vibration pattern when modal appears
  React.useEffect(() => {
    if (alert) {
      // Vibration pattern: 500ms vibration, 500ms pause, 500ms vibration
      const pattern = [0, 500, 500, 500];
      Vibration.vibrate(pattern, true); // Repeat indefinitely
      
      return () => {
        // Stop vibration when component unmounts
        Vibration.cancel();
      };
    }
  }, [alert]);

  if (!alert) return null;

  const { reading, alertType } = alert;
  
  // Format values for display
  const glucoseValue = reading.value;
  const formattedTime = reading.timestamp.toLocaleTimeString();
  const formattedDate = reading.timestamp.toLocaleDateString();
  
  // Determine alert message and color based on type
  const alertMessage = alertType === 'HIGH' ? 'VERY HIGH GLUCOSE' : 'VERY LOW GLUCOSE';
  const alertColor = alertType === 'HIGH' ? '#ff5252' : '#4a6dff';
  
  return (
    <Modal
      visible={!!alert}
      transparent={true}
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View style={[styles.modalContainer, { borderColor: alertColor }]}>
          <View style={[styles.alertHeader, { backgroundColor: alertColor }]}>
            <Text style={styles.alertTitle}>{alertMessage}</Text>
          </View>
          
          <View style={styles.contentContainer}>
            <Text style={styles.glucoseValue}>{glucoseValue} mg/dL</Text>
            <Text style={styles.timestamp}>{formattedTime}</Text>
            <Text style={styles.date}>{formattedDate}</Text>
            
            <View style={styles.messageContainer}>
              <Text style={styles.message}>
                {alertType === 'HIGH' 
                  ? 'Your glucose is above the safe threshold. Please take appropriate action.'
                  : 'Your glucose is below the safe threshold. Please take appropriate action.'}
              </Text>
            </View>
            
            <TouchableOpacity 
              style={[styles.dismissButton, { backgroundColor: alertColor }]} 
              onPress={onDismiss}
            >
              <Text style={styles.dismissButtonText}>ACKNOWLEDGE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: width * 0.85,
    backgroundColor: 'white',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
  },
  alertHeader: {
    padding: 15,
    alignItems: 'center',
  },
  alertTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  contentContainer: {
    padding: 20,
    alignItems: 'center',
  },
  glucoseValue: {
    fontSize: 48,
    fontWeight: 'bold',
    marginVertical: 10,
  },
  timestamp: {
    fontSize: 18,
    fontWeight: '500',
  },
  date: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
  },
  messageContainer: {
    marginVertical: 15,
    paddingHorizontal: 10,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  dismissButton: {
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 25,
    marginTop: 10,
  },
  dismissButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default AlertModal; 