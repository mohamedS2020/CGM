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
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../firebase/firebaseconfig';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';

// Interface for note object
interface Note {
  id?: string;
  title: string;
  body: string;
  timestamp: Date;
  createdAt?: Date;
}

const NotesScreen = () => {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Modal states
  const [modalVisible, setModalVisible] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);

  // Fetch notes from Firestore
  const fetchNotes = useCallback(async () => {
    if (!user) return;
    
    try {
      const notesRef = collection(db, 'users', user.uid, 'notes');
      const q = query(notesRef, orderBy('timestamp', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const fetchedNotes: Note[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        fetchedNotes.push({
          id: doc.id,
          title: data.title,
          body: data.body,
          timestamp: data.timestamp.toDate(),
          createdAt: data.createdAt?.toDate()
        });
      });
      
      setNotes(fetchedNotes);
    } catch (error) {
      console.error('Error fetching notes:', error);
      Alert.alert('Error', 'Failed to fetch notes');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  // Handle refresh
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchNotes();
  }, [fetchNotes]);

  // Load notes when component mounts
  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Open modal to add a new note
  const handleAddNote = () => {
    setEditMode(false);
    setSelectedNote(null);
    setTitle('');
    setBody('');
    setModalVisible(true);
  };

  // Open modal to edit an existing note
  const handleEditNote = (note: Note) => {
    setEditMode(true);
    setSelectedNote(note);
    setTitle(note.title);
    setBody(note.body);
    setModalVisible(true);
  };

  // Open delete confirmation modal
  const handleDeleteConfirmation = (note: Note) => {
    setSelectedNote(note);
    setDeleteModalVisible(true);
  };

  // Save note (add new or update existing)
  const saveNote = async () => {
    if (!user) return;
    if (!title.trim()) {
      Alert.alert('Error', 'Note title cannot be empty');
      return;
    }
    
    setSaving(true);
    
    try {
      if (editMode && selectedNote?.id) {
        // Update existing note
        const noteRef = doc(db, 'users', user.uid, 'notes', selectedNote.id);
        await updateDoc(noteRef, {
          title,
          body,
          timestamp: serverTimestamp()
        });
        
        // Update state
        setNotes(prevNotes => prevNotes.map(note => 
          note.id === selectedNote.id
            ? { ...note, title, body, timestamp: new Date() }
            : note
        ));
        
        Alert.alert('Success', 'Note updated successfully');
      } else {
        // Add new note
        const notesRef = collection(db, 'users', user.uid, 'notes');
        const newNote = {
          title,
          body,
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp()
        };
        
        const docRef = await addDoc(notesRef, newNote);
        
        // Update state
        const now = new Date();
        setNotes(prevNotes => [
          {
            id: docRef.id,
            title,
            body,
            timestamp: now,
            createdAt: now
          },
          ...prevNotes
        ]);
        
        Alert.alert('Success', 'Note added successfully');
      }
      
      // Close modal
      setModalVisible(false);
    } catch (error) {
      console.error('Error saving note:', error);
      Alert.alert('Error', 'Failed to save note');
    } finally {
      setSaving(false);
    }
  };

  // Delete note
  const deleteNote = async () => {
    if (!user || !selectedNote?.id) return;
    
    try {
      const noteRef = doc(db, 'users', user.uid, 'notes', selectedNote.id);
      await deleteDoc(noteRef);
      
      // Update state
      setNotes(prevNotes => prevNotes.filter(note => note.id !== selectedNote.id));
      
      // Close delete modal
      setDeleteModalVisible(false);
      Alert.alert('Success', 'Note deleted successfully');
    } catch (error) {
      console.error('Error deleting note:', error);
      Alert.alert('Error', 'Failed to delete note');
    }
  };

  // Format date for display
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Render note item in the list
  const renderNoteItem = ({ item }: { item: Note }) => (
    <TouchableOpacity 
      style={styles.noteItem}
      onPress={() => handleEditNote(item)}
    >
      <View style={styles.noteContent}>
        <Text style={styles.noteTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.notePreview} numberOfLines={2}>
          {item.body}
        </Text>
        <Text style={styles.noteDate}>
          {formatDate(item.timestamp)}
        </Text>
      </View>
      
      <TouchableOpacity 
        style={styles.deleteButton}
        onPress={() => handleDeleteConfirmation(item)}
      >
        <Ionicons name="trash-outline" size={20} color="#F72585" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header with Add Button */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Notes</Text>
        <TouchableOpacity 
          style={styles.addButton}
          onPress={handleAddNote}
        >
          <Ionicons name="add" size={24} color="white" />
        </TouchableOpacity>
      </View>
      
      {/* Notes List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4361EE" />
          <Text style={styles.loadingText}>Loading notes...</Text>
        </View>
      ) : notes.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="document-text-outline" size={64} color="#ccc" />
          <Text style={styles.emptyText}>No notes yet</Text>
          <Text style={styles.emptySubtext}>
            Tap the + button to create your first note
          </Text>
        </View>
      ) : (
        <FlatList
          data={notes}
          renderItem={renderNoteItem}
          keyExtractor={item => item.id || ''}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#4361EE']}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No notes found</Text>
            </View>
          }
        />
      )}
      
      {/* Note Edit/Add Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editMode ? 'Edit Note' : 'New Note'}
              </Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setModalVisible(false)}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalBody}>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Title</Text>
                <TextInput
                  style={styles.titleInput}
                  placeholder="Note title"
                  value={title}
                  onChangeText={setTitle}
                  maxLength={100}
                />
              </View>
              
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Content</Text>
                <TextInput
                  style={styles.bodyInput}
                  placeholder="Write your note here..."
                  value={body}
                  onChangeText={setBody}
                  multiline
                  textAlignVertical="top"
                />
              </View>
              
              <TouchableOpacity
                style={styles.saveButton}
                onPress={saveNote}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>
                    {editMode ? 'Update Note' : 'Save Note'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      
      {/* Delete Confirmation Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={deleteModalVisible}
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModalContent}>
            <Text style={styles.deleteModalTitle}>Delete Note</Text>
            <Text style={styles.deleteModalMessage}>
              Are you sure you want to delete "{selectedNote?.title}"?
              This action cannot be undone.
            </Text>
            
            <View style={styles.deleteModalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setDeleteModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.deleteConfirmButton}
                onPress={deleteNote}
              >
                <Text style={styles.deleteConfirmButtonText}>Delete</Text>
              </TouchableOpacity>
            </View>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#4361EE',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
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
    paddingHorizontal: 16,
    paddingBottom: 120,
    paddingTop: 5
  },
  noteItem: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.22,
    shadowRadius: 2.22,
    elevation: 3,
  },
  noteContent: {
    flex: 1,
    marginRight: 10,
  },
  noteTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  notePreview: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  noteDate: {
    fontSize: 12,
    color: '#999',
  },
  deleteButton: {
    padding: 5,
    justifyContent: 'center',
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
    paddingBottom: Platform.OS === 'ios' ? 30 : 0,
    height: '70%',
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
    flex: 1,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 16,
    color: '#666',
    marginBottom: 10,
  },
  titleInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
  },
  bodyInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
    minHeight: 200,
    flex: 1,
  },
  saveButton: {
    backgroundColor: '#4361EE',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 175,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  deleteModalContent: {
    margin: 20,
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  deleteModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  deleteModalMessage: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
    lineHeight: 22,
  },
  deleteModalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    marginRight: 10,
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '500',
  },
  deleteConfirmButton: {
    backgroundColor: '#F72585',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
  },
  deleteConfirmButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
});

export default NotesScreen; 