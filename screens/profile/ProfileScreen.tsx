import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
  Modal,
  TouchableWithoutFeedback,
  Animated
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { storage } from '../../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation';
import { uploadToCloudinary } from '../../services/cloudinaryService';

// Gender options for the gender picker
const GENDER_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'];

type ProfileScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const ProfileScreen = () => {
  const { user, userData, updateUserProfile, logout } = useAuth();
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  
  const [loading, setLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showGenderPicker, setShowGenderPicker] = useState(false);
  const [showPhotoDrawer, setShowPhotoDrawer] = useState(false);
  const drawerAnimation = useRef(new Animated.Value(0)).current;
  
  // Form state
  const [formData, setFormData] = useState({
    displayName: '',
    age: '',
    gender: '',
    phoneNumber: '',
    normalGlucose: '',
    doctorName: '',
    imageURL: ''
  });

  // Load user data into the form
  useEffect(() => {
    if (userData) {
      setFormData({
        displayName: userData.displayName || '',
        age: userData.age ? userData.age.toString() : '',
        gender: userData.gender || '',
        phoneNumber: userData.phoneNumber || '',
        normalGlucose: userData.normalGlucose ? userData.normalGlucose.toString() : '',
        doctorName: userData.doctorName || '',
        imageURL: userData.imageURL || ''
      });
    }
  }, [userData]);

  // Function to request permissions only when needed
  const requestPhotoPermissions = async (type: 'camera' | 'library'): Promise<boolean> => {
    if (Platform.OS === 'web') return true;
    
    try {
      // This will trigger the system's permission dialog automatically
      if (type === 'camera' && ImagePicker.requestCameraPermissionsAsync) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        return status === 'granted';
      } else if (type === 'library' && ImagePicker.requestMediaLibraryPermissionsAsync) {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        return status === 'granted';
      }
      return false;
    } catch (error) {
      console.error(`Error requesting ${type} permissions:`, error);
      return false;
    }
  };

  // Show the photo drawer
  const handleImagePick = () => {
    setShowPhotoDrawer(true);
    Animated.timing(drawerAnimation, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  // Hide the photo drawer
  const hidePhotoDrawer = () => {
    Animated.timing(drawerAnimation, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setShowPhotoDrawer(false);
    });
  };

  // Bottom drawer for photo selection
  const renderPhotoDrawer = () => {
    const translateY = drawerAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [300, 0],
    });

    return (
      <Modal
        visible={showPhotoDrawer}
        transparent
        animationType="none"
        onRequestClose={hidePhotoDrawer}
      >
        <TouchableWithoutFeedback onPress={hidePhotoDrawer}>
          <View style={styles.drawerOverlay}>
            <Animated.View
              style={[
                styles.photoDrawer,
                {
                  transform: [{ translateY }],
                },
              ]}
            >
              <View style={styles.drawerHandle} />
              <Text style={styles.drawerTitle}>Choose Photo Source</Text>
              
              <TouchableOpacity
                style={styles.drawerOption}
                onPress={() => {
                  hidePhotoDrawer();
                  setTimeout(() => {
                    launchCamera();
                  }, 300);
                }}
              >
                <Ionicons name="camera" size={24} color="#4361EE" />
                <Text style={styles.drawerOptionText}>Take Photo</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.drawerOption}
                onPress={() => {
                  hidePhotoDrawer();
                  setTimeout(() => {
                    launchImageLibrary();
                  }, 300);
                }}
              >
                <Ionicons name="images" size={24} color="#4361EE" />
                <Text style={styles.drawerOptionText}>Choose from Library</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.drawerCancelButton}
                onPress={hidePhotoDrawer}
              >
                <Text style={styles.drawerCancelText}>Cancel</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    );
  };

  // Open camera to take a new photo
  const launchCamera = async () => {
    try {
      // This triggers the system permission dialog if not already granted
      const permissionGranted = await requestPhotoPermissions('camera');
      
      if (!permissionGranted) {
        // Only show this if permissions were denied - helps user find settings
        Alert.alert(
          'Permission Denied', 
          'Camera access is required to take a profile photo. Please enable it in your device settings.',
          [{ text: 'OK' }]
        );
        return;
      }
      
      // Proceed with camera if permission is granted
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      
      if (!result.canceled && result.assets && result.assets.length > 0) {
        await uploadImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo. The camera may not be available.');
    }
  };

  // Open image library to pick an existing photo
  const launchImageLibrary = async () => {
    try {
      // This triggers the system permission dialog if not already granted
      const permissionGranted = await requestPhotoPermissions('library');
      
      if (!permissionGranted) {
        // Only show this if permissions were denied - helps user find settings
        Alert.alert(
          'Permission Denied', 
          'Photo library access is required to select a profile picture. Please enable it in your device settings.',
          [{ text: 'OK' }]
        );
        return;
      }
      
      // Proceed with photo library if permission is granted
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      
      if (!result.canceled && result.assets && result.assets.length > 0) {
        await uploadImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. The image library may not be available.');
    }
  };

  // Upload image to Cloudinary
  const uploadImage = async (uri: string) => {
    if (!user) return;
    
    setUploadingImage(true);
    
    try {
      // Upload to Cloudinary
      const cloudinaryUrl = await uploadToCloudinary(uri);
      
      if (!cloudinaryUrl) {
        throw new Error('Failed to upload image to Cloudinary');
      }
      
      console.log('Cloudinary URL obtained:', cloudinaryUrl);
      
      // Update form data
      setFormData(prev => ({ ...prev, imageURL: cloudinaryUrl }));
      
      // Update user profile
      await updateUserProfile({ imageURL: cloudinaryUrl });
      
      Alert.alert('Success', 'Profile image updated successfully');
    } catch (error: any) {
      console.error('Error uploading image:', error);
      
      let errorMessage = 'Failed to upload image. Please try again.';
      
      // Handle specific error messages
      if (error.message) {
        if (error.message.includes('network')) {
          errorMessage = 'Network connection unstable. Please try again when you have a better connection.';
        } else if (error.message.includes('format')) {
          errorMessage = 'Invalid image format. Please select a different image.';
        }
      }
      
      Alert.alert('Error', errorMessage);
    } finally {
      setUploadingImage(false);
    }
  };

  // Save profile changes
  const handleSaveProfile = async () => {
    setLoading(true);
    
    try {
      // Convert numeric fields
      const updatedData = {
        displayName: formData.displayName,
        gender: formData.gender,
        phoneNumber: formData.phoneNumber,
        doctorName: formData.doctorName,
        age: formData.age ? parseInt(formData.age) : undefined,
        normalGlucose: formData.normalGlucose ? parseInt(formData.normalGlucose) : undefined
      };
      
      await updateUserProfile(updatedData);
      setEditMode(false);
      Alert.alert('Success', 'Profile updated successfully');
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  // Handle form input changes
  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Select gender from picker
  const handleGenderSelect = (gender: string) => {
    setFormData(prev => ({ ...prev, gender }));
    setShowGenderPicker(false);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profile</Text>
          
          {!editMode ? (
            <TouchableOpacity 
              style={styles.editButton} 
              onPress={() => setEditMode(true)}
            >
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={styles.cancelButton} 
              onPress={() => {
                // Reset form data to original values
                if (userData) {
                  setFormData({
                    displayName: userData.displayName || '',
                    age: userData.age ? userData.age.toString() : '',
                    gender: userData.gender || '',
                    phoneNumber: userData.phoneNumber || '',
                    normalGlucose: userData.normalGlucose ? userData.normalGlucose.toString() : '',
                    doctorName: userData.doctorName || '',
                    imageURL: userData.imageURL || ''
                  });
                }
                setEditMode(false);
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
        
        {/* Profile Image Section */}
        <View style={styles.imageContainer}>
          {uploadingImage ? (
            <View style={styles.profileImage}>
              <ActivityIndicator size="large" color="#4361EE" />
            </View>
          ) : formData.imageURL ? (
            <View style={styles.profileImageWrapper}>
              <Image 
                source={{ uri: formData.imageURL }} 
                style={styles.profileImage} 
              />
              {editMode && (
                <TouchableOpacity 
                  style={styles.editImageIcon}
                  onPress={handleImagePick}
                >
                  <Ionicons name="camera" size={22} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.profileImageWrapper}>
              <View style={styles.profileImagePlaceholder}>
                <Text style={styles.profileImagePlaceholderText}>
                  {formData.displayName ? formData.displayName.charAt(0).toUpperCase() : 'U'}
                </Text>
              </View>
              {editMode && (
                <TouchableOpacity 
                  style={styles.editImageIcon}
                  onPress={handleImagePick}
                >
                  <Ionicons name="camera" size={22} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          )}
          
          {editMode && (
            <TouchableOpacity 
              style={styles.changeImageButton}
              onPress={handleImagePick}
            >
              <Text style={styles.changeImageText}>Change Profile Photo</Text>
            </TouchableOpacity>
          )}
        </View>
        
        {/* Profile Information Form */}
        <View style={styles.formContainer}>
          {/* Display Name */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Full Name</Text>
            {editMode ? (
              <TextInput
                style={styles.input}
                value={formData.displayName}
                onChangeText={(value) => handleInputChange('displayName', value)}
                placeholder="Enter your full name"
              />
            ) : (
              <Text style={styles.value}>{formData.displayName || 'Not set'}</Text>
            )}
          </View>
          
          {/* Email (read-only) */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{user?.email || 'Not set'}</Text>
          </View>

          {/* Age */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Age</Text>
            {editMode ? (
              <TextInput
                style={styles.input}
                value={formData.age}
                onChangeText={(value) => handleInputChange('age', value.replace(/[^0-9]/g, ''))}
                keyboardType="numeric"
                placeholder="Enter your age"
              />
            ) : (
              <Text style={styles.value}>{formData.age || 'Not set'}</Text>
            )}
          </View>
          
          {/* Gender */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Gender</Text>
            {editMode ? (
              <View>
                <TouchableOpacity
                  style={styles.genderSelector}
                  onPress={() => setShowGenderPicker(!showGenderPicker)}
                >
                  <Text style={styles.genderSelectorText}>
                    {formData.gender || 'Select gender'}
                  </Text>
                  <Ionicons 
                    name={showGenderPicker ? "chevron-up" : "chevron-down"} 
                    size={18} 
                    color="#666" 
                  />
                </TouchableOpacity>
                
                {showGenderPicker && (
                  <View style={styles.genderOptionsContainer}>
                    {GENDER_OPTIONS.map((option) => (
                      <TouchableOpacity
                        key={option}
                        style={styles.genderOption}
                        onPress={() => handleGenderSelect(option)}
                      >
                        <Text style={styles.genderOptionText}>{option}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <Text style={styles.value}>{formData.gender || 'Not set'}</Text>
            )}
          </View>
          
          {/* Phone Number */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Phone Number</Text>
            {editMode ? (
              <TextInput
                style={styles.input}
                value={formData.phoneNumber}
                onChangeText={(value) => handleInputChange('phoneNumber', value)}
                keyboardType="phone-pad"
                placeholder="Enter your phone number"
              />
            ) : (
              <Text style={styles.value}>{formData.phoneNumber || 'Not set'}</Text>
            )}
          </View>
          
          <View style={styles.divider} />
          
          {/* Medical Information */}
          <Text style={styles.sectionTitle}>Medical Information</Text>
          
          {/* Normal Glucose Level */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Normal Glucose Level (mg/dL)</Text>
            {editMode ? (
              <TextInput
                style={styles.input}
                value={formData.normalGlucose}
                onChangeText={(value) => handleInputChange('normalGlucose', value.replace(/[^0-9]/g, ''))}
                keyboardType="numeric"
                placeholder="Enter your normal glucose level"
              />
            ) : (
              <Text style={styles.value}>{formData.normalGlucose || 'Not set'}</Text>
            )}
          </View>
          
          {/* Doctor Name */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Doctor's Name</Text>
            {editMode ? (
              <TextInput
                style={styles.input}
                value={formData.doctorName}
                onChangeText={(value) => handleInputChange('doctorName', value)}
                placeholder="Enter your doctor's name"
              />
            ) : (
              <Text style={styles.value}>{formData.doctorName || 'Not set'}</Text>
            )}
          </View>

          {/* Sign Out Option */}
          {!editMode && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.signOutOption}
                onPress={async () => {
                  try {
                    Alert.alert(
                      'Sign Out',
                      'Are you sure you want to sign out?',
                      [
                        {
                          text: 'Cancel',
                          style: 'cancel'
                        },
                        {
                          text: 'Sign Out',
                          style: 'destructive',
                          onPress: async () => {
                            try {
                              console.log('Starting sign out process...');
                              await logout();
                              console.log('Sign out successful');
                              // The navigation.reset approach doesn't work because SignIn is in a parent navigator
                              // Let the AuthContext handle navigation automatically through the conditional rendering
                              // in the root Navigation component instead of explicitly navigating
                            } catch (error) {
                              console.error('Error signing out:', error);
                              Alert.alert('Error', 'Failed to sign out. Please try again.');
                            }
                          }
                        }
                      ]
                    );
                  } catch (error) {
                    console.error('Error in sign out process:', error);
                    Alert.alert('Error', 'An unexpected error occurred. Please try again.');
                  }
                }}
              >
                <Ionicons name="log-out-outline" size={20} color="#f44336" style={styles.signOutIcon} />
                <Text style={styles.signOutText}>Sign Out</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        
        {/* Save Button */}
        {editMode && (
          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleSaveProfile}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        )}
        
        {/* Spacing at the bottom */}
        <View style={{ height: 40 }} />
      </ScrollView>
      {renderPhotoDrawer()}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  contentContainer: {
    paddingBottom: 120,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  editButton: {
    padding: 8,
    paddingHorizontal: 16,
    backgroundColor: '#4361EE',
    borderRadius: 20,
  },
  editButtonText: {
    color: 'white',
    fontWeight: '500',
  },
  cancelButton: {
    padding: 8,
    paddingHorizontal: 16,
    backgroundColor: '#e0e0e0',
    borderRadius: 20,
  },
  cancelButtonText: {
    color: '#666',
    fontWeight: '500',
  },
  imageContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  profileImageWrapper: {
    position: 'relative',
    borderRadius: 75,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  profileImage: {
    width: 150,
    height: 150,
    borderRadius: 75,
  },
  profileImagePlaceholder: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#4361EE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileImagePlaceholderText: {
    fontSize: 64,
    fontWeight: 'bold',
    color: 'white',
  },
  editImageIcon: {
    position: 'absolute',
    bottom: 2,
    right: 15,
    backgroundColor: 'rgb(76, 201, 240)',
    borderRadius: 18,
    width: 33,
    height: 33,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#f0f0f0',
  },
  changeImageButton: {
    marginTop: 16,
    backgroundColor: 'transparent',
  },
  changeImageText: {
    color: '#4361EE',
    fontSize: 16,
    fontWeight: '500',
  },
  formContainer: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  formGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  value: {
    fontSize: 18,
    color: '#333',
  },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    paddingVertical: 8,
    fontSize: 18,
    color: '#333',
  },
  genderSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    paddingVertical: 10,
  },
  genderSelectorText: {
    fontSize: 18,
    color: '#333',
  },
  genderOptionsContainer: {
    backgroundColor: 'white',
    borderRadius: 10,
    marginTop: 5,
    padding: 5,
    borderWidth: 1,
    borderColor: '#eee',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  genderOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  genderOptionText: {
    fontSize: 16,
    color: '#333',
  },
  divider: {
    height: 1,
    backgroundColor: '#ddd',
    marginVertical: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
  },
  saveButton: {
    backgroundColor: '#4361EE',
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 28,
    marginHorizontal: 40,
    marginVertical: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  signOutButton: {
    backgroundColor: '#f44336',
    flexDirection: 'row',
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    marginHorizontal: 120,
    marginVertical: 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  signOutButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  signOutIcon: {
    marginRight: 8,
  },
  signOutOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 5,
  },
  signOutText: {
    color: '#f44336',
    fontSize: 16,
    fontWeight: '500',
  },
  // Bottom drawer styles
  drawerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  photoDrawer: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 30,
  },
  drawerHandle: {
    width: 40,
    height: 5,
    backgroundColor: '#ccc',
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 10,
  },
  drawerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginVertical: 15,
    textAlign: 'center',
  },
  drawerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#efefef',
  },
  drawerOptionText: {
    fontSize: 16,
    marginLeft: 15,
    color: '#333',
  },
  drawerCancelButton: {
    marginTop: 15,
    paddingVertical: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    alignItems: 'center',
  },
  drawerCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F72585',
  },
});

export default ProfileScreen; 