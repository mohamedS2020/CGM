import { Alert } from 'react-native';
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from '@env';

/**
 * Upload an image to Cloudinary
 * @param uri Local URI of the image to upload
 * @returns Promise with the Cloudinary URL or null if upload failed
 */
export const uploadToCloudinary = async (uri: string): Promise<string | null> => {
  try {
    // Create form data for the upload
    const formData = new FormData();
    
    // Get the file extension
    const filename = uri.split('/').pop() || 'photo.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const fileType = match ? `image/${match[1]}` : 'image/jpeg';
    
    // Append the file to form data
    formData.append('file', {
      uri,
      name: filename,
      type: fileType,
    } as any);
    
    // Add upload preset (unsigned upload)
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    formData.append('folder', 'profile_images');
    
    // Upload to Cloudinary
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    
    const data = await response.json();
    
    // Check if upload was successful
    if (response.ok) {
      console.log('Cloudinary upload successful:', data.secure_url);
      return data.secure_url;
    } else {
      console.error('Cloudinary upload failed:', data);
      return null;
    }
  } catch (error) {
    console.error('Error uploading to Cloudinary:', error);
    return null;
  }
}; 