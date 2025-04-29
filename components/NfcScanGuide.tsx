import React, { useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  Animated, 
  Easing, 
  Dimensions,
  Image,
  TouchableOpacity
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface NfcScanGuideProps {
  visible: boolean;
  onTimeout?: () => void;
  onCancel?: () => void;
  timeoutDuration?: number; // in milliseconds
  message?: string;
}

const NfcScanGuide: React.FC<NfcScanGuideProps> = ({
  visible,
  onTimeout,
  onCancel,
  timeoutDuration = 30000, // 30 seconds default
  message = 'Hold your phone near the sensor'
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const moveAnim = useRef(new Animated.Value(0)).current;
  
  // Start animations when visible
  useEffect(() => {
    if (visible) {
      // Pulsing animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.3,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          })
        ])
      ).start();
      
      // Phone movement animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(moveAnim, {
            toValue: 1,
            duration: 2000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(moveAnim, {
            toValue: 0,
            duration: 2000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          })
        ])
      ).start();
      
      // Set timeout for scanning
      if (onTimeout) {
        const timer = setTimeout(() => {
          onTimeout();
        }, timeoutDuration);
        
        return () => clearTimeout(timer);
      }
    }
  }, [visible, pulseAnim, moveAnim, onTimeout, timeoutDuration]);
  
  // Compute movement translation for phone
  const translateY = moveAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -40]
  });
  
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Text style={styles.title}>Scanning for Sensor</Text>
          
          <View style={styles.animationContainer}>
            {/* Phone */}
            <Animated.View
              style={[
                styles.phoneContainer,
                {
                  transform: [
                    { translateY },
                  ]
                }
              ]}
            >
              <View style={styles.phone}>
                <Ionicons name="phone-portrait-outline" size={60} color="#333" />
              </View>
            </Animated.View>
            
            {/* Sensor with pulse animation */}
            <View style={styles.sensorArea}>
              <Animated.View
                style={[
                  styles.pulseCircle,
                  {
                    transform: [
                      { scale: pulseAnim }
                    ],
                    opacity: pulseAnim.interpolate({
                      inputRange: [1, 1.3],
                      outputRange: [0.6, 0]
                    })
                  }
                ]}
              />
              <View style={styles.sensor}>
                <Ionicons name="radio" size={40} color="#4361EE" />
              </View>
            </View>
          </View>
          
          <Text style={styles.message}>{message}</Text>
          
          <View style={styles.infoContainer}>
            <View style={styles.infoItem}>
              <Ionicons name="information-circle-outline" size={20} color="#666" />
              <Text style={styles.infoText}>Keep your phone still</Text>
            </View>
            
            <View style={styles.infoItem}>
              <Ionicons name="time-outline" size={20} color="#666" />
              <Text style={styles.infoText}>This may take a few seconds</Text>
            </View>
            
            <View style={styles.infoItem}>
              <Ionicons name="shield-checkmark-outline" size={20} color="#666" />
              <Text style={styles.infoText}>Remove phone case if scanning fails</Text>
            </View>
          </View>
          
          {onCancel && (
            <TouchableOpacity 
              style={styles.cancelButton} 
              onPress={onCancel}
            >
              <Ionicons name="close-circle-outline" size={20} color="white" />
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 24,
  },
  animationContainer: {
    height: 200,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  phoneContainer: {
    position: 'absolute',
    zIndex: 10,
  },
  phone: {
    padding: 10,
  },
  sensorArea: {
    position: 'absolute',
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sensor: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f0f3ff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e0e7ff',
  },
  pulseCircle: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#4361EE',
  },
  message: {
    fontSize: 18,
    color: '#333',
    marginBottom: 24,
    textAlign: 'center',
  },
  infoContainer: {
    width: '100%',
    marginTop: 16,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CC9F0',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 25,
    marginTop: 16,
  },
  cancelButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
});

export default NfcScanGuide; 